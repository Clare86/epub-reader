# EPUB Reader

A small, private EPUB reader that runs entirely in your web browser. Books are unzipped and read on your own computer and are never uploaded anywhere. There's nothing to install, no account to create, and no dependencies. It's just a few HTML, CSS and JavaScript files.

It was made for long, multi-chapter stories, including fanfiction downloaded from AO3 with tools such as Calibre or FanFicFare. It works with any standard (DRM-free) EPUB 2 or EPUB 3 file.

## Getting started

1. Download this repository (**Code → Download ZIP**, then unzip it) or clone it.
2. Open `index.html` in your browser by double-clicking it, or by dragging it onto a browser window.
3. Drop an `.epub` file onto the page, or click to choose one.

### If your progress isn't being saved

Some browsers limit storage for pages opened straight from a file (`file://`). If your place or bookmarks aren't kept, serve the folder locally instead. From inside the folder, run:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open http://127.0.0.1:8000/. Only your own computer can reach it.

### Adding it to the Dock (macOS)

`EPUB Reader.app` is a tiny launcher that opens `index.html` in your default browser. Drag it to the Dock to keep it there. It looks for `index.html` in the same folder, so keep the two together.

The app isn't signed, so macOS may block it the first time it's opened after downloading. If it does, right-click the app and choose **Open**. Or go to **System Settings → Privacy & Security** and click **Open Anyway**.

## Features

- **Contents sidebar**: built from the book's own table of contents. The current chapter is highlighted.
- **Chapter or whole story**: read one chapter at a time, or the whole story as one continuous scroll. Switching between them keeps your place.
- **Automatic resume**: your position is saved as you read, down to the paragraph. Reopening the book, or reloading the page, takes you straight back.
- **Named bookmarks**: mark places you want to return to. You can name, rename and delete them, and jump to any of them.
- **History**: every book you've opened, with when you last opened it, how far you've read and how many bookmarks it has. The most recent 40 books are kept in the browser and reopen with one click. For older ones you pick the file again, and your place is still remembered.
- **About this book**: all of the book's metadata, including the cover, summary, series, tags and dates. If the book has Calibre's custom columns (for example Fandom, Relationships, Status and Words from AO3 downloads), those show too. It also gives a word count worked out from the text.
- **Open another book at any time**: use the Open button, or drop a new file onto the page.
- **Comfortable reading**: adjustable text size, and light, sepia and dark themes.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` / `→` | Previous / next chapter (in chapter view) |
| `B` | Bookmark the current spot |
| `T` | Show or hide the sidebar |
| `I` | About this book |
| `O` | Open another book |

## Privacy and where data is kept

Nothing leaves your computer. The reader makes no network requests. Book content is cleaned before display: scripts are removed, and images or styles that would load from the internet are blocked. Links inside a book's text still work, and open in a new tab if you click them.

Everything is stored in your browser, for this page only:

- **localStorage** keeps settings, plus each book's reading position, bookmarks and last-opened time.
- **IndexedDB** keeps copies of the 40 most recently opened files, so they can be reopened without picking them again.

Each book is recognised by its source URL when it has one (such as an AO3 work link), otherwise by its EPUB identifier, otherwise by title and author. So if you download an updated version of a story, your place and bookmarks carry over. Saved data belongs to one browser: Chrome and Safari, for example, don't share it. Clearing your browser's site data for the page erases it.

## Browser support

The reader needs a reasonably recent browser: Chrome or Edge 105+, Safari 16.4+, or Firefox 121+. It relies on the built-in `DecompressionStream` to unzip books and the CSS `:has()` selector.

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
| `EPUB Reader.app` | Optional macOS launcher for the Dock |

## License

[MIT](LICENSE)
