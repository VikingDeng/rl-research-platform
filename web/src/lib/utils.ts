export function abbreviateVenue(venue: string | null | undefined): string {
  if (!venue) return 'N/A';
  const v = venue.toLowerCase();
  if (v.includes('aaai')) return 'AAAI';
  if (v.includes('neurips') || v.includes('neural information processing')) return 'NeurIPS';
  if (v.includes('cvpr')) return 'CVPR';
  if (v.includes('iclr')) return 'ICLR';
  if (v.includes('icml')) return 'ICML';
  if (v.includes('arxiv')) return 'arXiv';
  if (v.includes('nature')) return 'Nature';
  if (v.includes('science')) return 'Science';
  return venue.split(' ')[0].replace(/[^a-zA-Z]/g, '').toUpperCase() || 'CONF';
}

export function shortenPaperTitle(title: string | null | undefined): string {
  if (!title) return 'Untitled Paper';
  if (title.includes(':')) {
    return title.split(':')[0].trim();
  }
  return title.length > 30 ? title.slice(0, 30) + '...' : title;
}

export function getPdfUrl(paperId: string): string | null {
  if (!paperId) return null;
  if (paperId.startsWith('arxiv:')) return `https://arxiv.org/pdf/${paperId.split(':')[1]}.pdf`;
  if (paperId.startsWith('doi:')) return `https://doi.org/${paperId.split(':')[1]}`;
  if (paperId.includes('10.')) return `https://doi.org/${paperId}`;
  return null;
}
