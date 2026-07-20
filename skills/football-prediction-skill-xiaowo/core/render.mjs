import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const VIEWPORT = Object.freeze({ width: 430, height: 932 });

async function loadChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch (error) {
    throw new Error(`渲染预检失败：未安装或无法加载 Playwright（${error.message}）`, { cause: error });
  }
}

async function launchChromium() {
  const chromium = await loadChromium();
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`渲染预检失败：Playwright Chromium 不可用（${error.message}）`, { cause: error });
  }
}

export async function assertRendererAvailable() {
  const browser = await launchChromium();
  try {
    return { browserName: "chromium", version: browser.version() };
  } finally {
    await browser.close();
  }
}

async function resolveHtml(input) {
  if (typeof input === "string") return input;
  if (typeof input?.html === "string") return input.html;
  if (typeof input?.htmlPath === "string") return readFile(resolve(input.htmlPath), "utf8");
  throw new Error("渲染输入必须提供 html 字符串或 htmlPath。");
}

function resolveOutputPath(input) {
  const outputPath = typeof input === "object" && (input.outputPath ?? input.pngPath);
  if (!outputPath) throw new Error("渲染输入必须提供 outputPath 或 pngPath。");
  return resolve(outputPath);
}

export async function renderLongPng(input = {}) {
  const html = await resolveHtml(input);
  const outputPath = resolveOutputPath(input);
  await mkdir(dirname(outputPath), { recursive: true });

  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts?.ready);

    const measurements = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const documentWidth = Math.max(root.scrollWidth, body?.scrollWidth ?? 0);
      const clientWidth = root.clientWidth;
      const documentHeight = Math.ceil(Math.max(
        root.scrollHeight,
        root.offsetHeight,
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0
      ));
      const tables = [...document.querySelectorAll("table")];
      const tableOverflow = tables.flatMap((element, index) => {
        const rect = element.getBoundingClientRect();
        const overflow = element.scrollWidth > element.clientWidth + 1 || rect.left < -1 || rect.right > clientWidth + 1;
        return overflow ? [{ index, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, left: rect.left, right: rect.right }] : [];
      });
      const bodyText = body?.innerText ?? "";
      return {
        documentWidth,
        clientWidth,
        documentHeight,
        horizontalOverflow: documentWidth > clientWidth + 1,
        tableOverflow,
        replacementCharacterDetected: bodyText.includes("\uFFFD")
      };
    });

    await page.screenshot({ path: outputPath, type: "png", fullPage: true, animations: "disabled" });
    const screenshot = await stat(outputPath);
    const audit = {
      renderer: { browserName: "chromium", version: browser.version() },
      viewport: { ...VIEWPORT },
      documentHeight: measurements.documentHeight,
      documentWidth: measurements.documentWidth,
      viewportWidth: measurements.clientWidth,
      pageHeightValid: measurements.documentHeight > 0 && measurements.documentHeight <= 50_000,
      horizontalOverflow: measurements.horizontalOverflow,
      tableOverflow: measurements.tableOverflow,
      replacementCharacterDetected: measurements.replacementCharacterDetected,
      png: { path: outputPath, byteLength: screenshot.size, present: screenshot.isFile() && screenshot.size > 0 }
    };

    if (typeof input.auditPath === "string") {
      const auditPath = resolve(input.auditPath);
      await mkdir(dirname(auditPath), { recursive: true });
      await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    }
    return audit;
  } finally {
    await browser.close();
  }
}
