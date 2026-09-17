import type { AssetInfo } from '../../shared/protocol.ts';
import { webPathToUrl } from '../../shared/asset-path.ts';
import * as api from '../api.ts';
import { assetRefusal, uploadNote, visibleAssets } from '../asset-view.ts';
import { card } from '../group.ts';
import { icon } from '../icons.ts';
import { basename, footButton, inputEl, setButtonEnabled, styled, toast } from '../ui.ts';
import { buildMediaGrid, type GridTile } from './media-grid.ts';

/**
 * The image picker — the one block that earns a place above **Values**.
 *
 * It is a section of the inspector, not a modal. A list of fields cannot show
 * pictures, which is the whole reason this exists at all (WF-4 item 7); `src`
 * and `alt` themselves are ordinary Values rows, so nothing here duplicates a
 * field.
 *
 * **Picking stages. Nothing here writes source.** A tile click and an upload
 * both end in {@link ImagePickerDeps.pick}, which puts a value in the same
 * store a typed change goes to: the element wears amber and Save is the only
 * thing that touches a `.astro` file. The one write that does happen is the
 * upload itself — the bytes have to exist before a grid can show them — and it
 * lands in `uploadDir`, never in source.
 *
 * ## The trap this block exists to keep visible
 *
 * A `src` written verbatim reads back byte-perfect and still 404s in the built
 * site if the file does not sit under the public directory: `assetDirs` spans
 * both worlds by design, and only `publicDir` is copied into the output. So a
 * non-servable file is shown **dimmed with its reason** rather than hidden —
 * "you have no images" is the wrong answer to "not this one, and here is why"
 * (issue #9) — and `uploadDir` is named on screen, because that is where the
 * next file to fall into the trap would land.
 *
 * Which files are offered, in what order, and the sentence naming `uploadDir`
 * are `asset-view.ts`'s — pure, so the rule that keeps a `src` alive in the
 * built site is pinned by a test rather than by a browser.
 *
 * ## Where paging lives
 *
 * Here, not on the wire. `/assets` answers with one metadata array and no
 * cursor; the grid already owns a `footer` for exactly this button. Filtering
 * and paging are both views over that array, so they stay in one place — a
 * server that paged as well would mean two things deciding what eight images
 * mean.
 */

/** How many tiles a page of the grid shows. */
const PAGE = 8;

export interface ImagePickerDeps {
  /** The `src` the row currently holds — pending value included, since that is
   *  what the page is showing. Read on every repaint rather than captured: a
   *  pick changes it, and the `Current` ring has to follow. */
  currentSrc(): string;
  /**
   * Stage a picked file as this element's `src`, in URL form.
   *
   * The picker deals in **web paths** (`/images/a b.png`, what `/assets`
   * lists and what a tile is keyed by); source deals in **URLs**
   * (`/images/a%20b.png`). They differ only for a filename holding a character
   * a URL path must encode, and the conversion belongs here because this is
   * the only place composing a path out of a filename.
   */
  pick(url: string): void;
}

export interface ImagePicker {
  root: HTMLElement;
  /** Re-mark the current tile — the src row's value moved under us. */
  repaint(): void;
}

/** Build the picker card. It loads its own listing; a failure is a message with
 *  a Retry inside the grid, never a missing section. */
export function buildImagePicker(deps: ImagePickerDeps): ImagePicker {
  const section = card({ title: 'Pick an image',
    description: 'Project files only · picking stages the value, Save writes it' });

  let assets: AssetInfo[] = [];
  let publicDir = 'public';
  let uploadDir = 'public';
  let shown = PAGE;
  let failure: string | null = null;
  /** Files written since this picker opened may still be inside Vite's brief
   *  404 window, so their tiles need the retrying loader. */
  const openedAt = Date.now();

  const filter = inputEl('input', 'atx-asset-filter');
  filter.type = 'search';
  filter.placeholder = 'Filter images…';
  filter.addEventListener('input', () => { shown = PAGE; paint(); });

  const grid = buildMediaGrid({
    onSelect: () => {},
    onCommit: key => stage(key),
    emptyText: 'No images in the asset directories.',
  });

  const more = footButton('', 'outline', () => { shown += PAGE; paint(); });
  more.classList.add('atx-btn-sm');
  grid.footer.append(more);

  // --- upload ---------------------------------------------------------------

  const uploadRow = styled('div', 'atx-picker-upload');
  const file = styled('input', 'atx-media-file');
  file.type = 'file';
  file.accept = 'image/*';
  const uploadButton = footButton('Upload', 'outline', () => file.click());
  uploadButton.classList.add('atx-btn-sm');
  uploadButton.prepend(icon('upload', 16));
  const where = styled('p', 'atx-inspector-note');
  uploadRow.append(uploadButton, file);

  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    // Cleared so the same file picked twice in a row still fires `change`.
    file.value = '';
    if (chosen) void upload(chosen);
  });

  section.body.append(filter, grid.el, uploadRow, where);

  // --- behaviour ------------------------------------------------------------

  /** A pick is an edit like any other: it stages a value and stops. */
  function stage(webPath: string) {
    deps.pick(webPathToUrl(webPath));
    paint();
  }

  function paint() {
    if (failure) {
      grid.showMessage(failure, () => void load());
      more.hidden = true;
      return;
    }
    const list = visibleAssets(assets, filter.value, publicDir);
    const current = deps.currentSrc();
    grid.setTiles(list.slice(0, shown).map((asset): GridTile => {
      const refused = assetRefusal(asset, publicDir);
      return {
        key: asset.path,
        thumbUrl: asset.path,
        ...(asset.mtime > openedAt ? { fresh: true } : {}),
        label: asset.path,
        // Against the URL form as well as the raw path: the row holds what the
        // source holds, and an encoded filename is still this file.
        current: asset.path === current || webPathToUrl(asset.path) === current,
        caption: { kind: 'name', text: basename(asset.path), title: asset.path },
        ...(refused ? { disabledReason: refused.short, disabledTitle: refused.full } : {}),
      };
    }));
    const rest = list.length - shown;
    more.hidden = rest <= 0;
    more.textContent = `Show ${Math.min(PAGE, rest)} more · ${list.length} in this project`;
  }

  async function load() {
    failure = null;
    grid.showSkeletons();
    try {
      const listing = await api.getAssets();
      assets = listing.files;
      publicDir = listing.publicDir;
      uploadDir = listing.uploadDir;
    } catch (error) {
      failure = `Could not load the image list: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
    const note = uploadNote(uploadDir, publicDir);
    where.textContent = note.text;
    where.toggleAttribute('data-warn', note.warn);
    paint();
  }

  /**
   * Write the file, then stage its path.
   *
   * The upload is the one thing here that reaches disk before Save, and it has
   * to: a grid cannot show bytes that do not exist. It writes a **new asset**,
   * never a source patch — the `src` edit it produces is staged like any other
   * and is still one Save away.
   */
  async function upload(chosen: File) {
    if (!chosen.type.startsWith('image/')) {
      toast('That is not an image file', 'err');
      return;
    }
    setButtonEnabled(uploadButton, false);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(chosen);
      });
      const { webPath } = await api.upload({ dataUrl, filename: chosen.name });
      toast(`Uploaded ${basename(webPath)} to ${uploadDir}/ — its src is staged until Save`, 'ok');
      await load();
      // Whatever the filter was, the new file has to be reachable: it is the
      // one the user is looking for.
      filter.value = '';
      shown = PAGE;
      stage(webPath);
      grid.select(webPath);
    } catch (error) {
      toast(`Upload failed — ${error instanceof Error ? error.message : 'unknown error'}`, 'err');
    } finally {
      setButtonEnabled(uploadButton, true);
    }
  }

  void load();
  return { root: section.root, repaint: paint };
}
