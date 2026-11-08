# EPUB Reader

A small, private EPUB reader that runs entirely in your web browser. Books are unzipped and read on your own computer and are never uploaded anywhere. There's nothing to install, no account to create, and no dependencies. It's just a few HTML, CSS and JavaScript files.

It was made for long, multi-chapter stories, including fanfiction downloaded from AO3 with tools such as Calibre or FanFicFare. It works with any standard (DRM-free) EPUB 2 or EPUB 3 file.

**Use it online: https://clare86.github.io/epub-reader/** (books are still opened on your own computer, never uploaded)

## Getting started

To use it without going online, or to keep a copy of your own:

1. Download this repository (**Code → Download ZIP**, then unzip it) or clone it.
2. Open `index.html` in your browser by double-clicking it, or by dragging it onto a browser window.
3. Drop an `.epub` file onto the page, or click to choose one.

### If your progress isn't being saved

Some browsers limit storage for pages opened straight from a file (`file://`). If your place or bookmarks aren't kept, serve the folder locally instead. From inside the folder, run:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open http://127.0.0.1:8000/. Only your own computer can reach it. Served this way, the reader uses its offline copy (see below), so after editing its files, change `VERSION` in `sw.js` and reload twice to see them.

### Installing it on a phone or tablet

The online version can be installed like an app. It then opens full screen from its own icon, and works without an internet connection.

- **iPhone or iPad (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

On an iPhone or iPad, the installed app keeps its own reading positions, bookmarks and history, separate from Safari's. To carry them over, use **Export…** in Safari and **Import…** in the app. Android shares them with Chrome.

When a new version of the reader is published, a bar offers to reload into it.

### Adding it to the Dock (macOS)

`EPUB Reader.app` is a tiny launcher that opens `index.html` in your default browser. Drag it to the Dock to keep it there. It looks for `index.html` in the same folder, so keep the two together.

The app isn't signed, so macOS may block it the first time it's opened after downloading. If it does, right-click the app and choose **Open**. Or go to **System Settings → Privacy & Security** and click **Open Anyway**.

## Features

- **Contents sidebar**: built from the book's own table of contents. The current chapter is highlighted, and each entry shows its word count. In books divided into parts, the parts can be collapsed so only their names show. They start collapsed, except the part you're reading, and Expand all / Collapse all buttons appear at the top. A part's count includes its chapters. In chapter view, the word count also appears at the foot of the chapter.
- **Chapter or whole story**: read one chapter at a time, or the whole story as one continuous scroll. Switching between them keeps your place.
- **Automatic resume**: your position is saved as you read, down to the paragraph. Reopening the book, or reloading the page, takes you straight back.
- **Progress by words**: the percentage read is the words before your position out of the book's total, so long and short chapters count fairly and both views agree.
- **Search**: find any words in the book from the sidebar's search tab. Results are grouped by chapter with a snippet of each. Clicking one takes you there and highlights the words. Case, accents and curly versus straight quotes don't matter.
- **Named bookmarks**: mark places you want to return to. You can name, rename and delete them, and jump to any of them.
- **History**: every book you've opened, with when you last opened it, how far you've read and how many bookmarks it has. The most recent 40 books are kept in the browser and reopen with one click. For older ones you pick the file again, and your place is still remembered.
- **About this book**: all of the book's metadata, including the cover, summary, series, tags and dates. If the book has Calibre's custom columns (for example Fandom, Relationships, Status and Words from AO3 downloads), those show too. It also gives a word count worked out from the text.
- **Back up and restore**: export your positions, bookmarks, history and settings to a file, and import it later, for example after clearing your browser data or to move to another browser. Importing merges with what's already there.
- **Open another book at any time**: use the Open button, or drop a new file onto the page.
- **Comfortable reading**: adjustable text size, and light, sepia and dark themes.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` / `→` | Previous / next chapter (in chapter view) |
| `B` | Bookmark the current spot |
| `T` | Show or hide the sidebar |
| `I` | About this book |
| `/` | Search this book |
| `O` | Open another book |

## Privacy and where data is kept

Nothing leaves your computer. The reader makes no network requests. Book content is cleaned before display: scripts are removed, and images or styles that would load from the internet are blocked. Links inside a book's text still work, and open in a new tab if you click them.

Everything is stored in your browser, for this page only:

- **localStorage** keeps settings, plus each book's reading position, bookmarks and last-opened time.
- **IndexedDB** keeps copies of the 40 most recently opened files, so they can be reopened without picking them again.
- **A service worker** keeps a copy of the reader's own files (not your books) so it opens offline. This only applies when the reader is loaded from a web address. A copy opened straight from the file (including through the Dock launcher) doesn't use one.

Each book is recognised by its source URL when it has one (such as an AO3 work link), otherwise by its EPUB identifier, otherwise by title and author. So if you download an updated version of a story, your place and bookmarks carry over. Saved data belongs to one browser: Chrome and Safari, for example, don't share it. The online version and a downloaded copy also keep separate data; use Export and Import to move it between them. Clearing your browser's site data for the page erases it.

When you open a book, the reader asks the browser to keep its storage rather than clear it automatically when space runs low. Chrome and Safari decide this by themselves, and Firefox asks you once.

To keep a copy, use **Export…** under the drop area on the start screen (or **Export data…** at the top of the History tab). It saves a small `.json` file. **Import…** restores it: the newer reading position wins for each book, and bookmarks from both are kept. The backup doesn't include the books themselves, so after a restore each book shows "pick file to reopen" until you open its file once.

## Browser support

The reader needs a reasonably recent browser: Chrome or Edge 105+, Safari 16.4+, or Firefox 121+. It relies on the built-in `DecompressionStream` to unzip books and the CSS `:has()` selector. Search highlights the exact words where the browser supports CSS highlights (Chrome 105+, Safari 17.2+, Firefox 140+); otherwise it highlights the paragraph.

## Limitations

- The reader uses its own typography rather than each book's stylesheet. Bold, italics, headings and inline styles are kept.
- Fixed-layout EPUBs (picture books, comics) aren't laid out as designed.
- DRM-protected books can't be opened.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | The page and its styling |
| `zip.js` | Minimal ZIP reader using the browser's `DecompressionStream` |
| `epub.js` | Reads metadata, chapters and table of contents; cleans chapter HTML |
| `reader.js` | The interface, position saving, bookmarks and history |
| `favicon.svg` | Browser tab icon |
| `manifest.webmanifest`, `icons/` | Name and icons for installing to a home screen |
| `sw.js` | Service worker: keeps the reader's files for offline use. Change its `VERSION` whenever any file changes. |
| `EPUB Reader.app` | Optional macOS launcher for the Dock |

## License

[MIT](LICENSE)
