export const demoPapers = [
  {
    id: 'paper-transformer-eval',
    title: 'Evaluating Sparse Retrieval Signals for Long Scientific Papers',
    abstract:
      'A working fixture for the initial UI. The real implementation will replace this with persisted paper metadata.',
    status: 'awaiting-feedback',
    recommendation: 'Worth deep reading',
    updatedAt: '2026-04-08 19:20',
    agents: ['confirmed', 'awaiting-feedback', 'pending', 'pending'],
  },
  {
    id: 'paper-graph-reasoning',
    title: 'Graph-Grounded Reasoning Paths for Scientific QA',
    abstract:
      'A placeholder record to anchor the first root-level implementation. Data will move to SQLite once ingestion is wired.',
    status: 'parsing',
    recommendation: 'Pending',
    updatedAt: '2026-04-08 18:02',
    agents: ['pending', 'pending', 'pending', 'pending'],
  },
];

export const searchResults = [
  {
    id: '2504.00001',
    title: 'Adaptive Review Loops for Scientific Document Agents',
    authors: 'M. Lin, P. Costa, R. Singh',
    year: 2026,
    source: 'arXiv',
    abstract:
      'Explores multi-pass review loops for paper-reading agents and measures how confirmation gates improve output quality.',
  },
  {
    id: '2504.00002',
    title: 'Benchmarking Visual Evidence Use in Scholarly LLM Systems',
    authors: 'J. Park, H. Zhou',
    year: 2026,
    source: 'arXiv',
    abstract:
      'Evaluates whether agents inspect figures and tables before producing recommendations and long-form analysis.',
  },
];
