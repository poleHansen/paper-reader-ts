export interface UploadSectionInput {
  paperId: string;
  title: string;
  abstract?: string;
  extractedPdf: {
    previewText: string;
    pageLikeSegments: string[];
  } | null;
}

export function buildUploadSections({ paperId, title, abstract, extractedPdf }: UploadSectionInput) {
  const sections: Array<{
    paperId: string;
    sectionType: string;
    sectionKey: string;
    title: string;
    orderNo: number;
    content: string;
    tokenCount: number;
  }> = [];

  if (abstract) {
    sections.push({
      paperId,
      sectionType: 'abstract_summary',
      sectionKey: 'abstract-summary',
      title: `${title} abstract`,
      orderNo: 1,
      content: abstract,
      tokenCount: countTokens(abstract),
    });
  }

  let orderNo = sections.length + 1;

  if (extractedPdf?.previewText) {
    sections.push({
      paperId,
      sectionType: 'pdf_text_preview',
      sectionKey: 'pdf-text-preview',
      title: 'Extracted PDF text preview',
      orderNo,
      content: extractedPdf.previewText,
      tokenCount: countTokens(extractedPdf.previewText),
    });
    orderNo += 1;
  }

  extractedPdf?.pageLikeSegments.forEach((segment, index) => {
    sections.push({
      paperId,
      sectionType: 'pdf_segment',
      sectionKey: `pdf-segment-${index + 1}`,
      title: `PDF segment ${index + 1}`,
      orderNo: orderNo + index,
      content: segment,
      tokenCount: countTokens(segment),
    });
  });

  return sections;
}

function countTokens(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}
