// src/tools/charts.ts
// Construye URLs de QuickChart (sin librería extra)

type Dset = { label?: string; data: number[] };

function buildUrl(chart: any, w = 900, h = 380) {
  const base = 'https://quickchart.io/chart';
  const qs = encodeURIComponent(JSON.stringify(chart));
  return `${base}?c=${qs}&width=${w}&height=${h}&format=png&backgroundColor=white`;
}

export function createBarChartUrl(title: string, labels: string[], ...datasets: Dset[]) {
  const chart = {
    type: 'bar',
    data: { labels, datasets: datasets.map(d => ({ label: d.label ?? title, data: d.data })) },
    options: {
      responsive: true,
      plugins: {
        legend: { display: datasets.length > 1 },
        title: { display: true, text: title }
      },
      scales: { y: { beginAtZero: true } }
    }
  };
  return buildUrl(chart);
}

export function createLineChartUrl(title: string, labels: string[], ...datasets: Dset[]) {
  const chart = {
    type: 'line',
    data: { labels, datasets: datasets.map(d => ({ label: d.label ?? title, data: d.data, fill: false })) },
    options: {
      responsive: true,
      plugins: {
        legend: { display: datasets.length > 1 },
        title: { display: true, text: title }
      },
      scales: { y: { beginAtZero: true } }
    }
  };
  return buildUrl(chart);
}
