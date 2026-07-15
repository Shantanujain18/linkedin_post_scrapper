# Chrome extension installation

This extension runs directly inside the currently open Chrome profile, so it can use the existing LinkedIn login. The popup is React-built with Vite; the scraper runs as a Chrome content script. Playwright is included for automated build tests—Playwright itself cannot execute inside a Chrome extension.

## Install in the Vaishali profile

1. Open Terminal and build the extension:

   ```bash
   cd /Users/apple/Desktop/Linkedin_Scrapper/chrome-extension
   npm install
   npm run build
   ```

2. Open the Chrome profile.
3. Visit `chrome://extensions`.
4. Turn on **Developer mode** in the upper-right corner.
5. Click **Load unpacked**.
6. Select the compiled folder:

   `/Users/apple/Desktop/Linkedin_Scrapper/chrome-extension/dist`

7. Pin **LinkedIn Post CSV Scraper** from Chrome's Extensions menu.

## Export posts

1. Open any normal tab while signed into LinkedIn.
2. Click the extension icon.
3. Enter `hiring python` or different keywords.
4. Choose the maximum number of posts.
5. Click **Search and export**.
6. Keep that LinkedIn tab open. The extension opens LinkedIn Post search with the **Past 24 hours** filter (`datePosted=["past-24h"]`), expands each post's **more** control, scrolls, and downloads a CSV when finished.

The CSV contains `posted_by`, `posted_by_url`, `posted_date`, `posted_content`, `post_url`, and `scraped_at`.

To update the extension after changing its files, run `npm run build`, then return to `chrome://extensions` and click the extension's reload button. Make sure Chrome is loading `dist`, not the source folder.

If the status still says “No posts appeared,” reload the extension and start again from a LinkedIn tab. The current build reports the URL and a short description of what LinkedIn rendered, which helps distinguish a stale build from a login/search-page issue.
