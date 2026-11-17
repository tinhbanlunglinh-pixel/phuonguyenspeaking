import React, { useEffect, useMemo, useState } from 'react';
import { X, Printer, Copy, Check, FileSpreadsheet, FileText, Trash2 } from 'lucide-react';
import type { ClassData, Assignment, Submission, StudentInfo } from '../../services/classroom';

// ---------------- Tính điểm ----------------
interface Cell { score: number | null; state: 'graded' | 'pending' | 'none' }

const pad = (n: number) => String(n).padStart(2, '0');
const monthKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = (k: string) => { const [y, m] = k.split('-'); return `Tháng ${Number(m)}/${y}`; };
const dayLabel = (t: number) => { const d = new Date(t); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const round1 = (n: number) => Math.round(n * 10) / 10;
const f1 = (n: number | null) => (n == null ? '—' : String(round1(n)).replace('.', ','));

const scoreCls = (s: number | null) =>
  s == null ? 'text-slate-300' : s >= 8 ? 'text-blue-600' : s >= 5 ? 'text-amber-600' : 'text-red-600';

const rank = (s: number | null) =>
  s == null ? '—' : s >= 8.5 ? 'Giỏi' : s >= 7 ? 'Khá' : s >= 5 ? 'Đạt' : 'Cần cố gắng';

const getCell = (data: ClassData, aid: string, sid: string): Cell => {
  const sub = data.submissions?.[aid]?.[sid] as Submission | undefined;
  const r = data.results?.[sid]?.[aid];
  const sc = typeof r?.speakingScore === 'number' ? r.speakingScore : sub?.status === 'graded' && sub.result ? (sub.result.isSilent ? 0 : sub.result.score) : null;
  if (sc != null) return { score: sc, state: 'graded' };
  if (sub || r?.submitted) return { score: null, state: 'pending' };
  return { score: null, state: 'none' };
};

interface StudentRow { sid: string; name: string; cells: Cell[]; done: number; avg: number | null }

const buildRows = (data: ClassData, aids: string[]): StudentRow[] =>
  (Object.entries(data.students || {}) as [string, StudentInfo][])
    .map(([sid, st]) => {
      const cells = aids.map(aid => getCell(data, aid, sid));
      const scores = cells.map(c => c.score).filter((n): n is number => n != null);
      return {
        sid, name: st.name, cells,
        done: cells.filter(c => c.state !== 'none').length,
        avg: scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

/** Nhận xét chung của lớp, tạo tự động từ số liệu tháng (cô sửa lại được). */
const buildClassComment = (rows: StudentRow[], nAssign: number, callName: string): string => {
  const scored = rows.filter(r => r.avg != null);
  if (!nAssign) return `Tháng này ${callName} chưa giao bài nói nào cho lớp.`;
  if (!scored.length) return `Tháng này ${callName} đã giao ${nAssign} bài nói, các con chưa có bài nào được chấm điểm.`;
  const classAvg = round1(scored.reduce((a, r) => a + (r.avg as number), 0) / scored.length);
  const totalCells = rows.length * nAssign;
  const doneCells = rows.reduce((n, r) => n + r.done, 0);
  const rate = totalCells ? Math.round((doneCells / totalCells) * 100) : 0;
  const top = [...scored].sort((a, b) => (b.avg as number) - (a.avg as number)).filter(r => (r.avg as number) >= 8).slice(0, 5);
  const low = rows.filter(r => r.done < Math.ceil(nAssign / 2) || (r.avg != null && r.avg < 5));
  const L: string[] = [];
  L.push(`Trong tháng, ${callName} đã giao ${nAssign} bài nói. Cả lớp có ${rows.length} học sinh, tỉ lệ nộp bài đạt ${rate}%, điểm trung bình toàn lớp là ${f1(classAvg)}/10.`);
  if (classAvg >= 8) L.push('Nhìn chung các con đọc tự tin, phát âm rõ ràng và giữ nhịp đọc tốt.');
  else if (classAvg >= 6.5) L.push('Nhìn chung các con đọc khá tốt, phát âm tương đối rõ; một số con cần chú ý thêm âm cuối và ngữ điệu.');
  else L.push('Các con đã có nhiều cố gắng nhưng cần luyện thêm phát âm và độ trôi chảy khi đọc.');
  if (top.length) L.push(`Các bạn nổi bật: ${top.map(r => r.name).join(', ')}.`);
  if (low.length) L.push(`Cần được nhắc nhở và hỗ trợ thêm: ${low.map(r => r.name).join(', ')} (nộp bài chưa đều hoặc điểm còn thấp).`);
  L.push(`${callName} mong bố mẹ tiếp tục đồng hành, nhắc con luyện đọc mỗi ngày để tiến bộ hơn trong tháng tới.`);
  return L.join('\n');
};

const csvEsc = (s: string) => `"${s.replace(/"/g, '""')}"`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------- Bảng điểm theo ngày giao ----------------
export const ClassScoreboard: React.FC<{
  code: string; className: string; data: ClassData; callName: string;
}> = ({ code, className, data, callName }) => {
  const all = useMemo(
    () => (Object.entries(data.assignments || {}) as [string, Assignment][])
      .filter(([, a]) => !!a.createdAt)
      .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0)),
    [data.assignments],
  );
  const months = useMemo(() => {
    const set = new Set(all.map(([, a]) => monthKey(a.createdAt)));
    set.add(monthKey(Date.now()));
    return Array.from(set).sort().reverse();
  }, [all]);
  const [month, setMonth] = useState<string>(months[0]);
  useEffect(() => { if (!months.includes(month)) setMonth(months[0]); }, [months, month]);
  const [showReport, setShowReport] = useState(false);

  const inMonth = useMemo(() => all.filter(([, a]) => monthKey(a.createdAt) === month), [all, month]);
  const aids = inMonth.map(([id]) => id);
  const rows = useMemo(() => buildRows(data, aids), [data, aids.join(',')]);
  const scoredAvgs = rows.map(r => r.avg).filter((n): n is number => n != null);
  const classAvg = scoredAvgs.length ? round1(scoredAvgs.reduce((a, b) => a + b, 0) / scoredAvgs.length) : null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black text-blue-600 uppercase tracking-wider">Bảng điểm theo ngày giao bài</p>
          <p className="text-sm text-slate-500">Điểm tự cập nhật khi học sinh nộp bài và bài được chấm.</p>
        </div>
        <select value={month} onChange={e => setMonth(e.target.value)}
          className="px-3 py-2 rounded-xl border-2 border-blue-100 font-bold text-sm bg-white focus:outline-none focus:border-brand-green">
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <button onClick={() => setShowReport(true)} disabled={!rows.length}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-green text-white font-black text-sm hover:brightness-110 disabled:opacity-50">
          <FileText size={16} /> Báo cáo tháng
        </button>
      </div>

      {!rows.length ? (
        <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-8 text-center text-slate-400 text-sm">
          Chưa có học sinh nào vào lớp. Cô gửi mã lớp hoặc link cho học sinh nhé.
        </div>
      ) : !inMonth.length ? (
        <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-8 text-center text-slate-400 text-sm">
          {monthLabel(month)} chưa có bài nào được giao. Cô vào tab "Giao bài nói" để giao bài.
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-blue-50 text-[11px] text-blue-700">
                <tr>
                  <th className="sticky left-0 bg-blue-50 text-left px-3 py-3 font-black uppercase tracking-wider min-w-[150px]">Học sinh</th>
                  {inMonth.map(([id, a]) => (
                    <th key={id} className="px-2 py-2 font-bold min-w-[72px] align-bottom" title={a.topic}>
                      <div className="font-black text-blue-800">{dayLabel(a.createdAt)}</div>
                      <div className="font-semibold text-slate-500 max-w-[88px] truncate mx-auto">{a.topic}</div>
                    </th>
                  ))}
                  <th className="px-3 py-3 font-black uppercase tracking-wider whitespace-nowrap">TB tháng</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.sid} className="border-t border-blue-50 hover:bg-blue-50/40">
                    <td className="sticky left-0 bg-white px-3 py-2.5 font-bold text-slate-800">{r.name}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="text-center px-2">
                        {c.state === 'graded' ? <b className={scoreCls(c.score)}>{f1(c.score)}</b>
                          : c.state === 'pending' ? <span className="text-[11px] font-black text-amber-500">chờ chấm</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                    <td className={`text-center px-3 font-black ${scoreCls(r.avg)}`}>{f1(r.avg)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-blue-100 bg-blue-50/50">
                  <td className="sticky left-0 bg-blue-50 px-3 py-2.5 font-black text-blue-800">TB cả lớp</td>
                  {inMonth.map(([id], i) => {
                    const sc = rows.map(r => r.cells[i].score).filter((n): n is number => n != null);
                    const v = sc.length ? round1(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
                    return <td key={id} className={`text-center px-2 font-black ${scoreCls(v)}`}>{f1(v)}</td>;
                  })}
                  <td className={`text-center px-3 font-black ${scoreCls(classAvg)}`}>{f1(classAvg)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {showReport && (
        <MonthReportModal
          code={code} className={className} month={month} rows={rows} assignments={inMonth.map(([, a]) => a)}
          callName={callName} onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
};

// ---------------- Báo cáo tháng ----------------
const MonthReportModal: React.FC<{
  code: string; className: string; month: string; rows: StudentRow[]; assignments: Assignment[];
  callName: string; onClose: () => void;
}> = ({ code, className, month, rows, assignments, callName, onClose }) => {
  const storeKey = `pu_month_comment_${code}_${month}`;
  const auto = useMemo(() => buildClassComment(rows, assignments.length, callName), [rows, assignments.length, callName]);
  const [comment, setComment] = useState(() => { try { return localStorage.getItem(storeKey) || ''; } catch { return ''; } });
  const [edited, setEdited] = useState(() => { try { return !!localStorage.getItem(storeKey); } catch { return false; } });
  // chưa sửa → luôn theo số liệu mới nhất
  useEffect(() => { if (!edited) setComment(auto); }, [auto, edited]);
  const [copied, setCopied] = useState(false);

  const setText = (v: string) => {
    setComment(v); setEdited(true);
    try { localStorage.setItem(storeKey, v); } catch { /* bỏ qua */ }
  };
  const resetAuto = () => {
    setEdited(false); setComment(auto);
    try { localStorage.removeItem(storeKey); } catch { /* bỏ qua */ }
  };

  const title = `BÁO CÁO ${monthLabel(month).toUpperCase()}`;
  const scored = rows.map(r => r.avg).filter((n): n is number => n != null);
  const classAvg = scored.length ? round1(scored.reduce((a, b) => a + b, 0) / scored.length) : null;

  const asText = () => {
    const L = [`${title} — ${className}`, `Giáo viên: ${callName} · Số bài đã giao: ${assignments.length} · TB cả lớp: ${f1(classAvg)}/10`, ''];
    rows.forEach((r, i) => L.push(`${i + 1}. ${r.name}: ${f1(r.avg)}/10 (${rank(r.avg)}) — nộp ${r.done}/${assignments.length} bài`));
    L.push('', 'Nhận xét chung:', comment);
    return L.join('\n');
  };

  const copyText = async () => {
    try { await navigator.clipboard.writeText(asText()); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* bỏ qua */ }
  };

  const fileBase = `Bao-cao-${month}-${className.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9]+/g, '-')}`;

  const downloadCsv = () => {
    const lines = [
      [title, className].map(csvEsc).join(','),
      ['STT', 'Họ và tên', 'Số bài đã nộp', 'Số bài đã giao', 'Điểm trung bình', 'Xếp loại'].map(csvEsc).join(','),
      ...rows.map((r, i) => [String(i + 1), r.name, String(r.done), String(assignments.length), r.avg == null ? '' : String(r.avg), rank(r.avg)].map(csvEsc).join(',')),
      '',
      ['Điểm trung bình cả lớp', classAvg == null ? '' : String(classAvg)].map(csvEsc).join(','),
      ['Nhận xét chung', comment.replace(/\n/g, ' ')].map(csvEsc).join(','),
    ];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${fileBase}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const printPdf = () => {
    const w = window.open('', '_blank');
    if (!w) { alert('Trình duyệt đang chặn cửa sổ in. Cô cho phép cửa sổ bật lên rồi bấm lại nhé.'); return; }
    const body = rows.map((r, i) =>
      `<tr><td class="c">${i + 1}</td><td>${esc(r.name)}</td><td class="c">${r.done}/${assignments.length}</td><td class="c"><b>${f1(r.avg)}</b></td><td class="c">${rank(r.avg)}</td></tr>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(fileBase)}</title><style>
      body{font-family:'Times New Roman',serif;color:#111;margin:28px 36px}
      h1{text-align:center;margin:0;font-size:22px;color:#1d4ed8}h2{text-align:center;margin:4px 0 14px;font-size:16px;font-weight:600}
      .meta{display:flex;justify-content:space-between;font-size:14px;margin-bottom:10px}
      table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #555;padding:6px 8px}
      th{background:#dbeafe}.c{text-align:center}
      .box{margin-top:16px;border:1px solid #555;padding:10px 12px;font-size:14px;line-height:1.55;white-space:pre-wrap}
      .sign{margin-top:28px;text-align:right;font-size:14px}
      @media print{body{margin:14mm}}
    </style></head><body>
      <h1>${esc(title)}</h1><h2>${esc(className)} — Lớp Cô Phượng Uyên Speaking</h2>
      <div class="meta"><span>Số bài đã giao: <b>${assignments.length}</b></span><span>Điểm trung bình cả lớp: <b>${f1(classAvg)}/10</b></span></div>
      <table><thead><tr><th>STT</th><th>Họ và tên</th><th>Số bài nộp</th><th>Điểm TB</th><th>Xếp loại</th></tr></thead><tbody>${body}</tbody></table>
      <div class="box"><b>Nhận xét chung:</b>\n${esc(comment)}</div>
      <div class="sign">${esc(callName)}</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script>
    </body></html>`);
    w.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white z-10 flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-blue-100">
          <div className="min-w-0">
            <p className="text-[11px] font-black text-blue-600 uppercase tracking-wider">Báo cáo chung của lớp</p>
            <h3 className="text-lg sm:text-xl font-black text-brand-green-dark truncate">{monthLabel(month)} · {className}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl">{assignments.length} bài đã giao</span>
            <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl">{rows.length} học sinh</span>
            <span className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl">TB cả lớp: {f1(classAvg)}/10</span>
          </div>

          <div className="rounded-2xl border-2 border-blue-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-blue-50 text-[11px] uppercase tracking-wider text-blue-700">
                <tr><th className="px-3 py-2.5 w-12">STT</th><th className="text-left px-3 py-2.5">Họ và tên</th><th className="px-3 py-2.5">Số bài nộp</th><th className="px-3 py-2.5">Điểm TB</th><th className="px-3 py-2.5">Xếp loại</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.sid} className="border-t border-blue-50">
                    <td className="text-center px-3 py-2 text-slate-400 font-bold">{i + 1}</td>
                    <td className="px-3 py-2 font-bold text-slate-800">{r.name}</td>
                    <td className="text-center px-3 py-2">{r.done}/{assignments.length}</td>
                    <td className={`text-center px-3 py-2 font-black ${scoreCls(r.avg)}`}>{f1(r.avg)}</td>
                    <td className="text-center px-3 py-2 text-slate-600">{rank(r.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black text-blue-700 uppercase tracking-wider">Nhận xét chung (cô sửa được)</p>
              {edited && (
                <button onClick={resetAuto} className="flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-blue-600">
                  <Trash2 size={12} /> Tạo lại tự động
                </button>
              )}
            </div>
            <textarea value={comment} onChange={e => setText(e.target.value)} rows={7}
              className="w-full px-3 py-2.5 text-sm leading-relaxed border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={printPdf} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-green text-white font-black text-sm hover:brightness-110">
              <Printer size={16} /> In / Lưu PDF
            </button>
            <button onClick={downloadCsv} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 font-black text-sm hover:bg-blue-100">
              <FileSpreadsheet size={16} /> Tải Excel (CSV)
            </button>
            <button onClick={copyText} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 font-black text-sm hover:bg-blue-100">
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Đã chép' : 'Chép chữ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
