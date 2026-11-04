import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler);

export const PALETTE = ['#6027ff', '#4c1fe0', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9', '#64748b'];

const base = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
};

export function BarView({ labels, datasets, height = 260, stacked }) {
  return (
    <div style={{ height }}>
      <Bar data={{ labels, datasets: datasets.map((d, i) => ({ backgroundColor: d.backgroundColor || PALETTE[i % PALETTE.length], borderRadius: 5, ...d })) }}
        options={{ ...base, scales: { x: { stacked: !!stacked }, y: { stacked: !!stacked, beginAtZero: true } } }} />
    </div>
  );
}

export function LineView({ labels, datasets, height = 260 }) {
  return (
    <div style={{ height }}>
      <Line data={{ labels, datasets: datasets.map((d, i) => ({
        borderColor: d.borderColor || PALETTE[i % PALETTE.length],
        backgroundColor: d.backgroundColor || 'rgba(96,39,255,.12)',
        tension: 0.35, fill: true, pointRadius: 3, ...d,
      })) }} options={{ ...base, scales: { y: { beginAtZero: true } } }} />
    </div>
  );
}

export function DoughnutView({ labels, data, height = 240 }) {
  return (
    <div style={{ height }}>
      <Doughnut data={{ labels, datasets: [{ data, backgroundColor: PALETTE, borderWidth: 0 }] }}
        options={{ ...base, cutout: '62%', scales: {} }} />
    </div>
  );
}

export function ChartCard({ title, subtitle, children, actions }) {
  return (
    <div className="card-soft p-3 h-100">
      <div className="d-flex justify-content-between align-items-start mb-2">
        <div>
          <div className="fw-semibold">{title}</div>
          {subtitle && <div className="small text-muted">{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
