# Solana Reply Generator Chrome Extension

Unpacked local extension for creating replies from Chrome's right-click menu.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension/` folder.

## Use

Right-click a Tweet page, a Tweet link, or selected text containing an X/Twitter status URL, then choose **Create Solana reply**.

The extension calls `https://solanareplygenerator.lol/api/reply` and opens X's reply composer with the generated text. If it cannot extract a Tweet ID or the API fails, it opens the generator site with the Tweet URL prefilled.
