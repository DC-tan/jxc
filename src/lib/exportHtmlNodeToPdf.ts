/**
 * 将 DOM 节点截图为多页 PDF（浏览器端，依赖 html2canvas + jspdf）
 *
 * 截图前将根节点约束为与目标幅面一致的内容宽度（@96dpi），按 scrollHeight 全量捕获；
 * 分页采用画布纵向切片写入 PDF。
 */
const A4_W_MM = 210;
const A4_H_MM = 297;
const A5_W_MM = 148;
const A5_H_MM = 210;
/** 与打印常用边距一致 */
const PDF_MARGIN_MM = 10;

export type ExportHtmlToPdfFormat = "a4" | "a5";

export type ExportHtmlToPdfOrientation = "portrait" | "landscape";

export type ExportHtmlToPdfOptions = {
  format?: ExportHtmlToPdfFormat;
  /** 默认：A4 纵向；A5 横向（与常见外发单打印一致） */
  orientation?: ExportHtmlToPdfOrientation;
  /** 用于约束内容宽度的内部节点；默认 A4 用采购预览根，A5 用外发单根 */
  innerSelector?: string;
};

/** 纸宽在 96dpi 下的像素宽度，用于屏上排版与 PDF 对齐 */
function paperContentWidthPx(paperW_mm: number): number {
  return Math.round((paperW_mm * 96) / 25.4);
}

function paperDims(
  format: ExportHtmlToPdfFormat,
  orientation: ExportHtmlToPdfOrientation,
): {
  paperW_mm: number;
  paperH_mm: number;
  contentW_mm: number;
  contentH_mm: number;
  captureWidthPx: number;
  jsPdfFormat: "a4" | "a5";
  jsPdfOrientation: ExportHtmlToPdfOrientation;
} {
  if (format === "a4") {
    const paperW_mm = A4_W_MM;
    const paperH_mm = A4_H_MM;
    return {
      paperW_mm,
      paperH_mm,
      contentW_mm: paperW_mm - 2 * PDF_MARGIN_MM,
      contentH_mm: paperH_mm - 2 * PDF_MARGIN_MM,
      captureWidthPx: paperContentWidthPx(paperW_mm),
      jsPdfFormat: "a4",
      jsPdfOrientation: "portrait",
    };
  }
  // A5：148×210 mm；横向时页面宽为长边 210mm
  const landscape = orientation === "landscape";
  const paperW_mm = landscape ? A5_H_MM : A5_W_MM;
  const paperH_mm = landscape ? A5_W_MM : A5_H_MM;
  return {
    paperW_mm,
    paperH_mm,
    contentW_mm: paperW_mm - 2 * PDF_MARGIN_MM,
    contentH_mm: paperH_mm - 2 * PDF_MARGIN_MM,
    captureWidthPx: paperContentWidthPx(paperW_mm),
    jsPdfFormat: "a5",
    jsPdfOrientation: landscape ? "landscape" : "portrait",
  };
}

function defaultInnerSelector(format: ExportHtmlToPdfFormat): string {
  return format === "a5" ? ".outsource-slip-print-root" : ".purchase-visual-print-root";
}

/**
 * @param options.format 默认 a4（与历史采购合同导出一致）；外发物料单请传 a5
 * @param options.orientation A5 未指定时默认为横向；A4 固定纵向
 */
export async function exportHtmlNodeToPdf(
  element: HTMLElement,
  filename: string,
  options?: ExportHtmlToPdfOptions,
): Promise<void> {
  const format: ExportHtmlToPdfFormat = options?.format ?? "a4";
  const orientation: ExportHtmlToPdfOrientation =
    options?.orientation ?? (format === "a5" ? "landscape" : "portrait");
  const { contentW_mm, contentH_mm, captureWidthPx, jsPdfFormat, jsPdfOrientation } =
    paperDims(format, orientation);
  const innerSel = options?.innerSelector ?? defaultInnerSelector(format);

  const inner = element.querySelector(innerSel) as HTMLElement | null;
  const touched: HTMLElement[] = inner ? [element, inner] : [element];
  const saved = touched.map((el) => ({
    el,
    width: el.style.width,
    maxWidth: el.style.maxWidth,
    boxSizing: el.style.boxSizing,
  }));

  try {
    for (const el of touched) {
      el.style.boxSizing = "border-box";
      if (el === element) {
        el.style.width = `${captureWidthPx}px`;
        el.style.maxWidth = `${captureWidthPx}px`;
      } else {
        el.style.width = "100%";
        el.style.maxWidth = "100%";
      }
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);

    const capW = Math.ceil(Math.max(element.scrollWidth, element.clientWidth, 1));
    const capH = Math.ceil(Math.max(element.scrollHeight, element.clientHeight, 1));

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      width: capW,
      height: capH,
      windowWidth: capW,
      windowHeight: capH,
      scrollX: 0,
      scrollY: 0,
    });

    const W = canvas.width;
    const H = canvas.height;
    if (W < 1 || H < 1) {
      throw new Error("截图失败：画布尺寸无效");
    }

    const pdf = new jsPDF({
      orientation: jsPdfOrientation,
      unit: "mm",
      format: jsPdfFormat,
    });

    /** 每 1mm 宽度对应的像素数（与 contentW_mm、W 一致） */
    const pxPerMm = W / contentW_mm;
    /** 单页内容区可容纳的截图像素高度 */
    const pageSlicePx = Math.max(1, Math.floor(contentH_mm * pxPerMm));

    let offsetY = 0;
    let isFirstPage = true;

    while (offsetY < H) {
      if (!isFirstPage) pdf.addPage();
      isFirstPage = false;

      const slicePx = Math.min(pageSlicePx, H - offsetY);
      if (slicePx <= 0) break;

      const sliceH_mm = (slicePx / W) * contentW_mm;

      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = W;
      sliceCanvas.height = slicePx;
      const ctx = sliceCanvas.getContext("2d");
      if (!ctx) throw new Error("无法创建画布上下文");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, slicePx);
      ctx.drawImage(canvas, 0, offsetY, W, slicePx, 0, 0, W, slicePx);

      pdf.addImage(
        sliceCanvas.toDataURL("image/png", 1),
        "PNG",
        PDF_MARGIN_MM,
        PDF_MARGIN_MM,
        contentW_mm,
        sliceH_mm,
      );

      offsetY += slicePx;
    }

    pdf.save(filename);
  } finally {
    for (const s of saved) {
      s.el.style.width = s.width;
      s.el.style.maxWidth = s.maxWidth;
      s.el.style.boxSizing = s.boxSizing;
    }
  }
}
