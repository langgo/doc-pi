export async function gotoFixture(page, baseUrl, pathname = '/') {
  await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('Fixtures'));
}

export async function selectFirstParagraphText(page, length = 12) {
  return page.evaluate((take) => {
    const paragraph = document.querySelector('.markdown-content p');
    if (!paragraph) throw new Error('Missing paragraph');
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (!node) throw new Error('Missing paragraph text');
    const selectedText = node.textContent.trim().slice(0, take);
    const idx = node.textContent.indexOf(selectedText);
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + selectedText.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return selectedText;
  }, length);
}

export async function waitForCore(page) {
  await page.waitForFunction(() => window.__core__);
}

export async function waitForComments(page) {
  await page.waitForFunction(() => window.__core__ && window.__comments__);
}

export async function waitForAiQa(page) {
  await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
}
