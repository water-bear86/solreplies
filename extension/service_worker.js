importScripts('reply-generator-core.js');

const { MENU_ID, handleContextMenuClick } = globalThis.SolReplyExtension;

async function createContextMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Create Solana reply',
    contexts: ['page', 'link', 'selection'],
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void createContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuClick(info, tab, {
    fetch: globalThis.fetch.bind(globalThis),
    openTab: (url) => chrome.tabs.create({ url }),
  });
});
