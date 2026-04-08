import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ParsePaperButton } from '@/components/paper/parse-paper-button';
import { getPaperById } from '@/lib/repositories/paper-repository';
import { getLocalPaperFileInfo } from '@/lib/server/paper-file';

export default async function PaperDetailPage({
  params,
}: {
  params: Promise<{ paperId: string }>;
}) {
  const { paperId } = await params;
  const paper = await getPaperById(paperId);

  if (!paper) {
    notFound();
  }

  const authors = parseJsonArray(paper.authorsJson);
  const localFile = await getLocalPaperFileInfo(paper.originalFilePath);
  const remoteViewerUrl = buildRemoteViewerUrl(paper.sourcePlatform, paper.sourceUrl);
  const remoteOpenUrl = buildRemoteOpenUrl(paper.sourcePlatform, paper.sourceUrl);
  const pdfViewerUrl = localFile ? `/api/papers/${paper.id}/file` : remoteViewerUrl;
  const metrics = [
    { label: '章节', value: paper.sections.length },
    { label: '图表', value: paper.figures.length },
    { label: '参考文献', value: paper.references.length },
    { label: 'Agent 记录', value: paper.agentRuns.length },
  ];
  const quickActions = ['总结论文', '梳理论文大纲', '生成学习指南', '常见问题解答', '研究脉络'];
  const conceptChips = [
    paper.sourcePlatform ?? 'LOCAL',
    paper.parseStatus ?? 'PENDING',
    paper.analysisStatus ?? 'PENDING',
    paper.year ? String(paper.year) : 'YEAR ?',
  ];

  return (
    <div className="reader-shell">
      <aside className="reader-sidebar card">
        <div className="reader-sidebar__section">
          <div className="reader-sidebar__brand-row">
            <span className="reader-sidebar__brand">阅读助手</span>
            <Link href="/" style={sidebarGhostButton}>
              返回列表
            </Link>
          </div>
        </div>

        <div className="reader-sidebar__section">
          <div className="reader-sidebar__heading">核心概念速查</div>
          <div className="reader-chip-list">
            {conceptChips.map((item) => (
              <span key={item} className="reader-chip">
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="reader-sidebar__section">
          <div className="reader-sidebar__heading">快速开始</div>
          <div className="reader-action-list">
            {quickActions.map((item) => (
              <button key={item} type="button" className="reader-action-card">
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="reader-sidebar__section">
          <div className="reader-sidebar__heading">论文信息</div>
          <div className="reader-meta-list">
            <div>
              <span>作者</span>
              <strong>{authors.length > 0 ? authors.slice(0, 3).join('、') : '待补充'}</strong>
            </div>
            <div>
              <span>来源</span>
              <strong>{paper.sourcePlatform ?? 'local'}</strong>
            </div>
            <div>
              <span>PDF</span>
              <strong>{localFile ? formatFileSize(localFile.size) : '未上传'}</strong>
            </div>
          </div>
        </div>

        <div className="reader-sidebar__composer">
          <input value="问问这篇学术论文" readOnly aria-label="Ask the paper" />
          <span>{paper.sections.length} 段解析</span>
        </div>
      </aside>

      <section className="reader-main">
        <header className="reader-topbar card">
          <div className="reader-topbar__actions">
            <button type="button" className="reader-topbar__action reader-topbar__action--active">
              全文翻译
            </button>
            <button type="button" className="reader-topbar__action">AI 重排</button>
            <button type="button" className="reader-topbar__action">文字</button>
          </div>
          <div className="reader-topbar__links">
            <Link href="/search" style={topbarLinkButton}>
              文件夹
            </Link>
            {paper.sourceUrl ? (
              <a href={paper.sourceUrl} target="_blank" rel="noreferrer" style={topbarLinkButton}>
                原文
              </a>
            ) : null}
          </div>
        </header>

        <article className="reader-paper-surface card">
          <div className="reader-paper-page">
            <div className="reader-paper-page__eyebrow">{paper.sourcePlatform ?? 'Paper'} · 智能阅读视图</div>
            <h1 className="reader-paper-page__title">{paper.title ?? 'Untitled paper'}</h1>
            <h2 className="reader-paper-page__subtitle">{buildChineseTitle(paper.title)}</h2>

            <details className="reader-author-toggle">
              <summary>Author</summary>
              <div>{authors.length > 0 ? authors.join(', ') : 'No authors imported yet.'}</div>
            </details>

            <div className="reader-paper-page__content reader-paper-page__content--pdf">
              {pdfViewerUrl ? (
                <>
                  {localFile ? (
                    <div className="reader-paper-remote-banner">
                      <span>当前预览的是本地 PDF 文件。</span>
                      <a href={pdfViewerUrl} target="_blank" rel="noreferrer" style={topbarLinkButton}>
                        在新标签打开 PDF
                      </a>
                    </div>
                  ) : remoteOpenUrl ? (
                    <div className="reader-paper-remote-banner">
                      <span>当前预览的是远程原文 PDF。</span>
                      <a href={remoteOpenUrl} target="_blank" rel="noreferrer" style={topbarLinkButton}>
                        在新标签打开
                      </a>
                    </div>
                  ) : null}
                  <iframe
                    src={pdfViewerUrl}
                    title={paper.title ?? 'PDF viewer'}
                    className="reader-pdf-frame"
                  />
                </>
              ) : (
                <section className="reader-paper-section">
                  <h3>
                    原文预览
                    <span>unavailable</span>
                  </h3>
                  <p>当前既没有本地 PDF，也没有可嵌入的远程原文地址。</p>
                  {remoteOpenUrl ? (
                    <p>
                      <a href={remoteOpenUrl} target="_blank" rel="noreferrer" style={topbarLinkButton}>
                        打开原文链接
                      </a>
                    </p>
                  ) : null}
                </section>
              )}
            </div>
          </div>
        </article>
      </section>

      <aside className="reader-inspector">
        <section className="card" style={{ padding: '18px', display: 'grid', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
            <span className="pill">运行状态</span>
            <strong style={{ color: 'var(--accent)' }}>{paper.status}</strong>
          </div>
          <div className="reader-stat-grid">
            {metrics.map((item) => (
              <div key={item.label} className="reader-stat-card">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="reader-info-list">
            <div>
              <span>解析状态</span>
              <strong>{paper.parseStatus ?? 'pending'}</strong>
            </div>
            <div>
              <span>分析状态</span>
              <strong>{paper.analysisStatus ?? 'pending'}</strong>
            </div>
            <div>
              <span>年份</span>
              <strong>{paper.year ?? 'Unknown'}</strong>
            </div>
            <div>
              <span>本地文件</span>
              <strong>{localFile ? localFile.relativePath : 'No local PDF saved yet.'}</strong>
            </div>
          </div>
        </section>

        <section className="card" style={{ padding: '18px', display: 'grid', gap: '12px' }}>
          <span className="pill">操作</span>
          <ParsePaperButton paperId={paper.id} />
          <Link href="/search" style={secondaryButton}>
            导入更多论文
          </Link>
          <Link href="/" style={primaryButton}>
            回到列表
          </Link>
        </section>

        <section className="card" style={{ padding: '18px', display: 'grid', gap: '10px' }}>
          <span className="pill">时间</span>
          <div className="reader-info-list">
            <div>
              <span>创建时间</span>
              <strong>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(paper.createdAt)}</strong>
            </div>
            <div>
              <span>更新时间</span>
              <strong>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(paper.updatedAt)}</strong>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function buildChineseTitle(title: string | null) {
  if (!title) {
    return '论文智能导读';
  }

  return `${title.slice(0, 48)}${title.length > 48 ? '…' : ''}`;
}

function buildRemoteViewerUrl(sourcePlatform: string | null, sourceUrl: string | null) {
  if (!sourceUrl) {
    return null;
  }

  if (sourcePlatform === 'arxiv') {
    const absUrl = sourceUrl.trim();
    const match = absUrl.match(/arxiv\.org\/(abs|pdf)\/([^?#]+)/i);
    const rawId = match?.[2]?.replace(/\.pdf$/i, '')?.trim();

    if (!rawId) {
      return absUrl.toLowerCase().endsWith('.pdf') ? absUrl : null;
    }

    const normalizedId = rawId.replace(/^arxiv:/i, '');
    return `https://arxiv.org/pdf/${normalizedId}.pdf`;
  }

  return sourceUrl;
}

function buildRemoteOpenUrl(sourcePlatform: string | null, sourceUrl: string | null) {
  if (!sourceUrl) {
    return null;
  }

  if (sourcePlatform === 'arxiv') {
    const absUrl = sourceUrl.trim();
    const match = absUrl.match(/arxiv\.org\/(abs|pdf)\/([^?#]+)/i);
    const rawId = match?.[2]?.replace(/\.pdf$/i, '')?.trim();

    if (!rawId) {
      return absUrl;
    }

    const normalizedId = rawId.replace(/^arxiv:/i, '');
    return `https://arxiv.org/abs/${normalizedId}`;
  }

  return sourceUrl;
}

const primaryButton: React.CSSProperties = {
  padding: '13px 18px',
  borderRadius: '999px',
  border: 'none',
  background: 'var(--accent)',
  color: '#fff7f0',
  fontWeight: 700,
  textAlign: 'center',
};

const secondaryButton: React.CSSProperties = {
  ...primaryButton,
  background: 'transparent',
  color: 'var(--foreground)',
  border: '1px solid var(--border)',
};

const topbarLinkButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 16px',
  borderRadius: '999px',
  border: '1px solid var(--border)',
  color: 'var(--foreground)',
  fontWeight: 600,
  background: 'rgba(255,255,255,0.7)',
};

const sidebarGhostButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8px 12px',
  borderRadius: '999px',
  border: '1px solid var(--border)',
  color: 'var(--muted)',
  fontSize: '13px',
  fontWeight: 600,
};
