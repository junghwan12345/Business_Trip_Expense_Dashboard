import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { groupProofImagesByDate, titleForProofDate } from "./proof-ppt.js";

const require = createRequire(import.meta.url);
let PptxGenJS;
try {
  PptxGenJS = require("pptxgenjs");
} catch {
  const bundledNodeModules = join(
    homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "node",
    "node_modules"
  );
  PptxGenJS = require(join(
    bundledNodeModules,
    ".pnpm",
    "pptxgenjs@4.0.1",
    "node_modules",
    "pptxgenjs",
    "dist",
    "pptxgen.cjs.js"
  ));
}

export async function buildProofPptxBuffer({ monthKey, images }) {
  const grouped = groupProofImagesByDate(images, monthKey);
  if (!grouped.length) {
    throw new Error("PPT로 만들 증빙 이미지가 없습니다.");
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "출장비 증빙 캡처";
  pptx.subject = `${monthKey} 지출결의서 증빙자료`;
  pptx.title = `${monthKey} 지출결의서 증빙자료`;
  pptx.company = "";
  pptx.lang = "ko-KR";
  pptx.theme = {
    headFontFace: "Malgun Gothic",
    bodyFontFace: "Malgun Gothic",
    lang: "ko-KR"
  };

  for (const group of grouped) {
    if ([...(group.route || []), ...(group.oil || []), ...(group.extra || [])].length) {
      addProofSlide(pptx, group);
    }
    for (const section of expenseProofSections(group)) {
      addExpenseProofSlide(pptx, group, section);
    }
  }

  return pptx.write({ outputType: "nodebuffer" });
}

function expenseProofSections(group) {
  return [
    { key: "welfare", label: "조활비 증빙", images: group.welfare || [] },
    { key: "supply", label: "소모품비 증빙", images: group.supply || [] },
    { key: "review", label: "확인필요 증빙", images: group.review || [] }
  ].filter((section) => section.images.length);
}

function addProofSlide(pptx, group) {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 0.38,
    w: 11.75,
    h: 0.42,
    line: { color: "E2F0D9", transparency: 100 },
    fill: { color: "E2F0D9" }
  });
  slide.addText(titleForProofDate(group.dateKey), {
    x: 0.8,
    y: 0.41,
    w: 11.75,
    h: 0.36,
    align: "center",
    fontFace: "Malgun Gothic",
    fontSize: 20,
    bold: false,
    color: "000000",
    margin: 0
  });

  const placements = proofSlidePlacements(group);
  placements.forEach(({ image, box }) => {
    if ((!image.dataUri && !image.path) || !box) {
      return;
    }
    slide.addImage({
      path: image.path && !image.dataUri ? image.path : undefined,
      data: image.dataUri,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      sizing: { type: "contain", x: box.x, y: box.y, w: box.w, h: box.h }
    });
  });
}

function addExpenseProofSlide(pptx, group, section) {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 0.38,
    w: 11.75,
    h: 0.42,
    line: { color: "E2F0D9", transparency: 100 },
    fill: { color: "E2F0D9" }
  });
  slide.addText(`${titleForProofDate(group.dateKey)} ${section.label}`, {
    x: 0.8,
    y: 0.41,
    w: 11.75,
    h: 0.36,
    align: "center",
    fontFace: "Malgun Gothic",
    fontSize: 20,
    bold: false,
    color: "000000",
    margin: 0
  });

  const content = { x: 0.8, y: 1.12, w: 11.75, h: 5.85 };
  section.images.forEach((image, index) => {
    const box = gridBox(index, section.images.length, content);
    if ((!image.dataUri && !image.path) || !box) {
      return;
    }
    slide.addImage({
      path: image.path && !image.dataUri ? image.path : undefined,
      data: image.dataUri,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      sizing: { type: "contain", x: box.x, y: box.y, w: box.w, h: box.h }
    });
  });
}

export function proofSlidePlacements(group) {
  const route = group.route || [];
  const oil = group.oil || [];
  const extra = group.extra || [];
  const placements = [];
  const content = { x: 0.75, y: 1.25, w: 11.8, h: 5.55 };
  const gap = 0.35;

  if (!extra.length) {
    const mainImages = [...route, ...oil];
    return mainImages.map((image, index) => ({
      image,
      box: compactRowBox(index, mainImages.length, content)
    }));
  }

  const routeBox = { x: content.x, y: content.y + 0.1, w: 3.55, h: 4.95 };
  const oilBox = { x: routeBox.x + routeBox.w + gap, y: content.y + 0.1, w: 2.55, h: 4.65 };
  const extraArea = {
    x: oilBox.x + oilBox.w + gap,
    y: content.y,
    w: content.x + content.w - (oilBox.x + oilBox.w + gap),
    h: content.h
  };

  placements.push(...route.map((image, index) => ({
    image,
    box: stackBox(index, route.length, routeBox, 0.16)
  })));
  placements.push(...oil.map((image, index) => ({
    image,
    box: stackBox(index, oil.length, oilBox, 0.16)
  })));
  placements.push(...extra.map((image, index) => ({
    image,
    box: gridBox(index, extra.length, extraArea)
  })));

  return placements;
}

function compactRowBox(index, count, area) {
  const gap = 0.45;
  const maxWidths = { 1: 4.4, 2: 4.1, 3: 3.4 };
  const boxWidth = Math.min(maxWidths[count] || 3.0, (area.w - gap * (count - 1)) / count);
  const totalWidth = boxWidth * count + gap * (count - 1);
  const x = area.x + (area.w - totalWidth) / 2 + index * (boxWidth + gap);
  return { x, y: area.y + 0.1, w: boxWidth, h: 4.9 };
}

function stackBox(index, count, area, gap) {
  if (count <= 1) {
    return area;
  }
  const h = (area.h - gap * (count - 1)) / count;
  return { x: area.x, y: area.y + index * (h + gap), w: area.w, h };
}

function gridBox(index, count, area) {
  const gap = 0.28;
  if (count <= 1) {
    return {
      x: area.x + 0.1,
      y: area.y + 0.1,
      w: Math.min(3.35, area.w - 0.2),
      h: area.h - 0.2
    };
  }
  const columns = count <= 2 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cellW = (area.w - gap * (columns - 1)) / columns;
  const cellH = (area.h - gap * (rows - 1)) / rows;
  const w = Math.min(cellW, count >= 4 ? 1.85 : 2.45);
  const h = Math.min(cellH, rows >= 2 ? 2.45 : 4.65);
  const row = Math.floor(index / columns);
  const column = index % columns;
  const gridW = w * columns + gap * (columns - 1);
  const gridH = h * rows + gap * (rows - 1);
  return {
    x: area.x + (area.w - gridW) / 2 + column * (w + gap),
    y: area.y + (area.h - gridH) / 2 + row * (h + gap),
    w,
    h
  };
}
