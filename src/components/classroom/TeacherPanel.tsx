import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Copy, Check, LogOut, Mic, Users, BookOpen, Trash2, KeyRound, ChevronDown, ChevronRight, X, RefreshCw,
  Sparkles, ClipboardCheck, Play, FileText, Zap, AlertTriangle,
} from 'lucide-react';
import { BrandLogo } from '../BrandLogo';
import { ApiKeyModal } from '../ApiKeyModal';
import { ReportModal } from './ReportModal';
import {
  Assignment, ClassData, LessonResult, StudentInfo, Submission, VocabItem, addAssignment, changeTeacherPassword,
  createClass, deleteClass, fetchRecording, listenCallName, listenClass, listenTeacherClasses, removeAssignment,
  removeStudent, resetToPending, saveCallName, DEFAULT_CALL_NAME,
  listenClassForGrading, SavedLesson, listenLibrary, saveToLibrary, markLibraryUsed, removeFromLibrary, newLibraryId, fetchLibraryAudio,
  listenSampleAudioDone, fetchSampleAudio, saveSampleAudio,
} from '../../services/classroom';
import { LessonCard, RecorderPreview } from './LessonCard';
import { ClassScoreboard } from './ClassScoreboard';
import { VoiceSettings } from './VoiceSettings';
import { getTtsProvider } from '../../services/elevenlabs';
import { getGeminiKeyPool, setKeyOverride, getApiKeyForProvider as mainKey } from '../../services/geminiService';
import { makeLessonImage, makeLessonAudio } from '../../utils/lessonMedia';
import { SAMPLE_LESSONS, LEVEL_INFO } from '../../data/sampleLessons';

const EMPTY_CLASS: ClassData = { info: null, students: {}, results: {}, assignments: {}, submissions: {} };

type Draft = {
  topic: string; readingText: string; translation: string; vocabulary: VocabItem[];
  origin: 'ai' | 'sample' | 'saved'; libId?: string; sampleId?: string;
  image?: string;
  exercise?: ExerciseData | null;
  /** giọng Leda lấy từ kho giọng bài mẫu (không tính là cô sửa bài) */
  sampleAudio?: boolean;
  /** WAV base64; null = chưa có; undefined = đang tải từ kho */
  audio?: string | null;
};
import type { ExerciseData } from '../../types';
import { generateContent, generateExercise, getAiProvider, getApiKeyForProvider, getSelectedModel, EnglishLevel } from '../../services/geminiService';
import { gradeSubmission, friendlyAiError } from '../../services/grading';

const LEVELS = ['Starters', 'Movers', 'Flyers', 'A1', 'A2', 'B1', 'B2'];

interface Props {
  onOpenStudio: () => void;
  onLogout: () => void;
}

const fmtTime = (t?: number) => {
  if (!t) return '—';
  const d = new Date(t);
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
};

const avg = (nums: number[]) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null);

const scoreColor = (s?: number | null) =>
  s == null ? 'text-slate-300' : s >= 8 ? 'text-blue-600' : s >= 5 ? 'text-amber-600' : 'text-red-600';

export const TeacherPanel: React.FC<Props> = ({ onOpenStudio, onLogout }) => {
  const [classes, setClasses] = useState<Record<string, { name: string; createdAt: number }>>({});
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<ClassData | null>(null);
  const [newClass, setNewClass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'students' | 'assign' | 'grade'>('students');
  const [resultView, setResultView] = useState<'board' | 'list'>('board');
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  // API key Gemini của cô (chỉ lưu trên máy cô)
  const [apiKey, setApiKey] = useState(() => getApiKeyForProvider());
  const [showKeyModal, setShowKeyModal] = useState(() => !getApiKeyForProvider());
  const [callName, setCallName] = useState(DEFAULT_CALL_NAME);
  useEffect(() => listenCallName(setCallName), []);

  // ---- Tự động chấm bài nộp (chạy trên máy cô) ----
  const [autoGrade, setAutoGrade] = useState(() => {
    try { return localStorage.getItem('pu_auto_grade') !== '0'; } catch { return true; }
  });
  const [gradingKey, setGradingKey] = useState<string | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const gradingRef = useRef(false);
  const failedRef = useRef<Set<string>>(new Set());

  // Nghe nền bài giao + bài nộp của MỌI lớp để chấm lần lượt cả loạt
  const [gradeData, setGradeData] = useState<Record<string, { assignments: Record<string, Assignment>; submissions: Record<string, Record<string, Submission>> }>>({});
  const [gradingCode, setGradingCode] = useState<string | null>(null);
  const classCodesKey = Object.keys(classes).sort().join(',');
  useEffect(() => {
    const codes = classCodesKey ? classCodesKey.split(',') : [];
    const unsubs = codes.map(c => listenClassForGrading(c, d => setGradeData(g => ({ ...g, [c]: d }))));
    return () => unsubs.forEach(u => u());
  }, [classCodesKey]);

  const runGrade = async (code: string, aid: string, sid: string) => {
    const a = gradeData[code]?.assignments?.[aid];
    if (!a || gradingRef.current) return;
    gradingRef.current = true;
    setGradingKey(`${aid}/${sid}`);
    setGradingCode(code);
    setGradeError(null);
    try {
      await gradeSubmission(code, aid, sid, a, callName);
      failedRef.current.delete(`${code}/${aid}/${sid}`);
    } catch (e: any) {
      failedRef.current.add(`${code}/${aid}/${sid}`);
      setGradeError(`${gradeData[code]?.submissions?.[aid]?.[sid]?.name || 'Bài nộp'}: ${e.message}`);
    } finally {
      gradingRef.current = false;
      setGradingKey(null);
      setGradingCode(null);
    }
  };

  /** Hàng đợi chấm của tất cả các lớp, bài nộp trước chấm trước */
  const pendingAll = useMemo(() => {
    const out: { code: string; aid: string; sid: string; t: number }[] = [];
    (Object.entries(gradeData) as [string, { assignments: Record<string, Assignment>; submissions: Record<string, Record<string, Submission>> }][]).forEach(([code, d]) => {
      Object.entries(d.submissions || {}).forEach(([aid, bySid]) => {
        if (!d.assignments?.[aid]?.readingText) return;
        Object.entries(bySid || {}).forEach(([sid, s]) => {
          if ((s as Submission).status === 'pending') out.push({ code, aid, sid, t: (s as Submission).submittedAt || 0 });
        });
      });
    });
    return out.sort((x, y) => x.t - y.t);
  }, [gradeData]);
  const pendingList = useMemo(() => pendingAll.filter(p => p.code === selected), [pendingAll, selected]);

  useEffect(() => {
    if (!autoGrade || !apiKey || gradingRef.current) return;
    const next = pendingAll.find(p => !failedRef.current.has(`${p.code}/${p.aid}/${p.sid}`));
    if (next) runGrade(next.code, next.aid, next.sid);
  }, [pendingAll, autoGrade, apiKey, gradingKey]);

  useEffect(() => listenTeacherClasses(
    c => { setClasses(c); setLoadingClasses(false); },
    e => { setError(e.message); setLoadingClasses(false); },
  ), []);

  // Tự chọn lớp đầu tiên
  useEffect(() => {
    const codes = Object.keys(classes);
    if (!selected && codes.length) setSelected(codes.sort((a, b) => (classes[b].createdAt || 0) - (classes[a].createdAt || 0))[0]);
    if (selected && !classes[selected]) setSelected(codes[0] || null);
  }, [classes, selected]);

  useEffect(() => {
    if (!selected) { setData(null); return; }
    setData(null);
    return listenClass(selected, setData, e => setError(e.message));
  }, [selected]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const code = await createClass(newClass);
      setNewClass('');
      setSelected(code);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  /** Nút trên đầu trang: mở khu thiết kế & giao bài (Kho bài mẫu + tạo bài + giao lớp) */
  const goDesign = () => {
    setTab('assign');
    setTimeout(() => document.getElementById('design-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* bỏ qua */ }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    return (Object.entries(data.students) as [string, StudentInfo][]).map(([sid, st]) => {
      const lessons = Object.entries(data.results[sid] || {})
        .map(([id, r]) => ({ id, ...(r as LessonResult) }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const speak = lessons.map(l => l.speakingScore).filter((n): n is number => typeof n === 'number');
      const ex = lessons.map(l => l.exerciseScore).filter((n): n is number => typeof n === 'number');
      return {
        sid, name: st.name, lastActive: st.lastActive || st.joinedAt, lessons,
        speakAvg: avg(speak), exAvg: avg(ex), submitted: lessons.filter(l => l.submitted).length,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [data]);

  const shareLink = selected ? `${window.location.origin}/?lop=${selected}` : '';
  const sortedCodes = Object.keys(classes).sort((a, b) => (classes[b].createdAt || 0) - (classes[a].createdAt || 0));

  // Bắt buộc có API key trước khi dùng Bảng giáo viên (tạo bài, chấm bài đều cần)
  if (!apiKey) {
    return (
      <div className="min-h-screen bg-blue-50/40 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border-4 border-blue-100 p-6 sm:p-8 text-center space-y-4">
          <BrandLogo className="w-16 h-16 mx-auto" />
          <h1 className="text-xl sm:text-2xl font-black text-brand-green-dark">Nhập API key để bắt đầu</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Cô cần nhập mã API key Gemini trước khi dùng Bảng giáo viên: key dùng để tạo bài và <b>chấm bài lần lượt</b> khi học sinh nộp.
            Key chỉ lưu trên máy cô, không gửi cho học sinh.
          </p>
          <button onClick={() => setShowKeyModal(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand-green text-white font-black hover:brightness-110">
            <Zap size={18} /> Nhập API key
          </button>
          <button onClick={onLogout} className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 mx-auto">
            <LogOut size={13} /> Đăng xuất
          </button>
        </div>
        <ApiKeyModal
          show={showKeyModal}
          currentApiKey={apiKey}
          initialProvider={getAiProvider()}
          initialModel={getSelectedModel()}
          onSave={k => { setApiKey(k); setShowKeyModal(false); failedRef.current.clear(); setGradeError(null); }}
          onClose={() => setShowKeyModal(false)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-blue-50/40">
      <header className="bg-brand-green border-b border-brand-green-dark sticky top-0 z-40 shadow-lg">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-16 sm:h-20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <BrandLogo className="w-10 h-10 sm:w-12 sm:h-12 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base sm:text-2xl font-black tracking-tight text-brand-yellow uppercase truncate">Bảng giáo viên</h1>
              <p className="hidden sm:block text-[10px] text-blue-100 font-bold tracking-wider uppercase">Cô Phượng Uyên · theo dõi lớp trực tiếp</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button onClick={goDesign} title="Thiết kế và giao bài cho học sinh — gồm Kho bài mẫu, tạo bài bằng AI, giao cho lớp"
              className="flex items-center gap-1.5 bg-brand-yellow text-slate-900 font-black text-xs sm:text-sm px-3 py-2 rounded-xl hover:brightness-95 text-left leading-tight">
              <BookOpen size={16} className="shrink-0" /> <span className="hidden sm:inline">Thiết kế và giao bài cho học sinh</span><span className="sm:hidden">Giao bài</span>
            </button>
            <button onClick={() => setShowKeyModal(true)} title="API key Gemini của cô (dùng để tạo bài và chấm bài)"
              className={`flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-black ${apiKey ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-amber-400 text-slate-900 animate-pulse'}`}>
              <Zap size={16} /> <span className="hidden md:inline">{apiKey ? 'API key' : 'Nhập API key'}</span>
            </button>
            <button onClick={() => setShowPass(true)} title="Đổi mật khẩu" className="p-2 rounded-xl bg-white/15 text-white hover:bg-white/25">
              <KeyRound size={18} />
            </button>
            <button onClick={onLogout} title="Đăng xuất" className="p-2 rounded-xl bg-white/15 text-white hover:bg-white/25">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Danh sách lớp */}
        <aside className="lg:col-span-4 space-y-4">
          <form onSubmit={handleCreate} className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-4 space-y-3">
            <p className="text-xs font-black text-blue-600 uppercase tracking-wider">Tạo lớp mới</p>
            <div className="flex gap-2">
              <input value={newClass} onChange={e => setNewClass(e.target.value)} placeholder="VD: Lớp 3A – Thứ 2,4"
                className="flex-1 min-w-0 px-3 py-2.5 text-sm border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
              <button disabled={busy} className="shrink-0 flex items-center gap-1 px-3 rounded-xl bg-brand-green text-white font-black text-sm disabled:opacity-60">
                {busy ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />} Tạo
              </button>
            </div>
          </form>

          <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-3 space-y-1">
            <p className="px-2 pt-1 pb-2 text-xs font-black text-blue-600 uppercase tracking-wider">Lớp của cô ({sortedCodes.length})</p>
            {loadingClasses && <p className="px-2 py-3 text-sm text-slate-400">Đang tải...</p>}
            {!loadingClasses && sortedCodes.length === 0 && (
              <p className="px-2 py-3 text-sm text-slate-400">Chưa có lớp nào. Cô tạo lớp ở ô phía trên nhé.</p>
            )}
            {sortedCodes.map(code => (
              <button key={code} onClick={() => setSelected(code)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-left transition-all ${
                  selected === code ? 'bg-blue-100 text-brand-green-dark' : 'hover:bg-slate-50 text-slate-700'}`}>
                <span className="font-bold text-sm truncate">{classes[code].name}</span>
                <span className="font-mono font-black text-xs tracking-widest bg-white border border-blue-200 rounded-lg px-2 py-0.5">{code}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Chi tiết lớp */}
        <section id="design-area" className="lg:col-span-8 space-y-4 min-w-0 scroll-mt-24">
          {(gradingKey || (autoGrade && pendingAll.length > 0)) && (
            <div className="flex items-center gap-2 text-sm font-bold text-blue-800 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
              <RefreshCw size={16} className="animate-spin shrink-0" />
              <span>
                {gradingKey && gradingCode
                  ? `Đang chấm bài của ${gradeData[gradingCode]?.submissions?.[gradingKey.split('/')[0]]?.[gradingKey.split('/')[1]]?.name || 'học sinh'} (lớp ${classes[gradingCode]?.name || gradingCode})`
                  : 'Đang chuẩn bị chấm bài…'}
                {pendingAll.length > 0 ? ` — còn ${pendingAll.length} bài chờ chấm, máy sẽ chấm lần lượt và gửi nhận xét cho học sinh.` : ''}
              </span>
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-start justify-between gap-2 text-sm font-bold text-red-700 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
              <span>{error}</span>
              <button onClick={() => setError(null)}><X size={16} /></button>
            </div>
          )}

          {!selected ? (
            <>
            <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-6 sm:p-8 text-center text-slate-400">
              <Users size={48} className="mx-auto mb-3 text-blue-200" />
              Cô chưa có lớp nào. Tạo lớp ở ô "Tạo lớp mới" để nhận mã lớp gửi học sinh — kho bài soạn sẵn ở ngay bên dưới.
            </div>
            <AssignTab code={null} data={EMPTY_CLASS} onError={setError} hasKey={!!apiKey} onNeedKey={() => setShowKeyModal(true)} classes={classes} />
              </>
          ) : (
            <>
              <div className="bg-gradient-to-br from-brand-green to-blue-600 rounded-3xl shadow-xl p-5 sm:p-6 text-white space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-wider text-blue-100">Lớp đang xem</p>
                    <h2 className="text-xl sm:text-2xl font-black truncate">{classes[selected]?.name}</h2>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-black uppercase tracking-wider text-blue-100">Mã lớp</p>
                    <button onClick={() => copy(selected, 'code')} className="flex items-center gap-2 font-mono text-2xl sm:text-3xl font-black tracking-[0.25em] text-brand-yellow">
                      {selected} {copied === 'code' ? <Check size={18} /> : <Copy size={18} className="opacity-70" />}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button onClick={() => copy(shareLink, 'link')} className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 px-3 py-2 rounded-xl font-bold max-w-full">
                    {copied === 'link' ? <Check size={14} /> : <Copy size={14} />}
                    <span className="truncate">{copied === 'link' ? 'Đã chép link' : 'Chép link vào lớp gửi phụ huynh'}</span>
                  </button>
                  <span className="bg-white/15 px-3 py-2 rounded-xl font-bold">{rows.length} học sinh</span>
                  <span className="bg-white/15 px-3 py-2 rounded-xl font-bold">{rows.reduce((n, r) => n + r.lessons.length, 0)} bài đã học</span>
                </div>
              </div>

              <div className="flex gap-2 bg-white p-1.5 rounded-2xl shadow border border-blue-100">
                {([['students', 'Kết quả', Users], ['assign', 'Thiết kế & giao bài', BookOpen], ['grade', 'Chấm & báo cáo', ClipboardCheck]] as const).map(([k, label, Icon]) => (
                  <button key={k} onClick={() => setTab(k)}
                    className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 px-1 rounded-xl font-black text-xs sm:text-sm transition-all ${
                      tab === k ? 'bg-brand-green text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Icon size={16} className="shrink-0" /> {label}
                    {k === 'grade' && pendingList.length > 0 && (
                      <span className="absolute -top-1.5 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-400 text-slate-900 text-[10px] font-black flex items-center justify-center">{pendingList.length}</span>
                    )}
                  </button>
                ))}
              </div>

              {!data ? (
                <p className="text-center text-slate-400 py-10">Đang tải dữ liệu lớp...</p>
              ) : tab === 'students' ? (
                <div className="space-y-4">
                  <div className="flex gap-2 bg-white p-1 rounded-xl border border-blue-100 w-fit">
                    {([['board', 'Bảng điểm & báo cáo tháng'], ['list', 'Danh sách học sinh']] as const).map(([k, label]) => (
                      <button key={k} onClick={() => setResultView(k)}
                        className={`px-3 py-1.5 rounded-lg font-black text-xs sm:text-sm ${resultView === k ? 'bg-blue-100 text-brand-green-dark' : 'text-slate-500 hover:bg-slate-50'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {resultView === 'board' ? (
                    <ClassScoreboard code={selected} className={classes[selected]?.name || ''} data={data} callName={callName} />
                  ) : (
                    <StudentsTable rows={rows} expanded={expanded} setExpanded={setExpanded}
                      onRemove={async (sid, name) => {
                        if (confirm(`Xoá học sinh "${name}" và toàn bộ kết quả của con khỏi lớp?`)) await removeStudent(selected, sid);
                      }} />
                  )}
                </div>
              ) : tab === 'assign' ? (
                <AssignTab code={selected} data={data} onError={setError} hasKey={!!apiKey} onNeedKey={() => setShowKeyModal(true)} classes={classes} />
              ) : (
                <GradeTab
                  code={selected} className={classes[selected]?.name || ''} data={data} hasKey={!!apiKey}
                  onNeedKey={() => setShowKeyModal(true)} callName={callName}
                  autoGrade={autoGrade}
                  setAutoGrade={v => { setAutoGrade(v); try { localStorage.setItem('pu_auto_grade', v ? '1' : '0'); } catch { /* bỏ qua */ } }}
                  gradingKey={gradingKey} gradeError={gradeError}
                  onGrade={(aid, sid) => { failedRef.current.delete(`${selected}/${aid}/${sid}`); runGrade(selected, aid, sid); }}
                  onRetry={async (aid, sid) => { failedRef.current.delete(`${selected}/${aid}/${sid}`); await resetToPending(selected, aid, sid); }}
                />
              )}

              <div className="text-right">
                <button
                  onClick={async () => {
                    if (confirm(`Xoá lớp "${classes[selected]?.name}" (mã ${selected})? Toàn bộ kết quả của lớp sẽ mất và không khôi phục được.`)) {
                      try { await deleteClass(selected); setSelected(null); } catch (e: any) { setError(e.message); }
                    }
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-red-600"
                >
                  <Trash2 size={14} /> Xoá lớp này
                </button>
              </div>
            </>
          )}
        </section>
      </main>

      {showPass && <ChangePasswordModal onClose={() => setShowPass(false)} />}

      <ApiKeyModal
        show={showKeyModal}
        currentApiKey={apiKey}
        initialProvider={getAiProvider()}
        initialModel={getSelectedModel()}
        onSave={k => { setApiKey(k); setShowKeyModal(false); failedRef.current.clear(); setGradeError(null); }}
        onClose={() => setShowKeyModal(false)}
      />
    </div>
  );
};

// ---------------- Bảng kết quả ----------------
type Row = {
  sid: string; name: string; lastActive?: number; speakAvg: number | null; exAvg: number | null; submitted: number;
  lessons: (LessonResult & { id: string })[];
};

const StudentsTable: React.FC<{
  rows: Row[]; expanded: string | null; setExpanded: (s: string | null) => void; onRemove: (sid: string, name: string) => void;
}> = ({ rows, expanded, setExpanded, onRemove }) => {
  if (!rows.length) {
    return (
      <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-8 text-center text-slate-400 text-sm">
        Chưa có học sinh nào vào lớp. Cô gửi mã lớp hoặc link cho học sinh nhé.
      </div>
    );
  }
  return (
    <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-blue-50 text-[11px] uppercase tracking-wider text-blue-700">
            <tr>
              <th className="text-left px-4 py-3 font-black">Học sinh</th>
              <th className="px-2 py-3 font-black">Số bài</th>
              <th className="px-2 py-3 font-black">Điểm nói TB</th>
              <th className="px-2 py-3 font-black">Bài tập TB</th>
              <th className="px-2 py-3 font-black">Đã nộp</th>
              <th className="px-2 py-3 font-black whitespace-nowrap">Hoạt động</th>
              <th className="px-2 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <React.Fragment key={r.sid}>
                <tr className="border-t border-blue-50 hover:bg-blue-50/40 cursor-pointer" onClick={() => setExpanded(expanded === r.sid ? null : r.sid)}>
                  <td className="px-4 py-3 font-bold text-slate-800">
                    <span className="inline-flex items-center gap-1.5">
                      {expanded === r.sid ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{r.name}
                    </span>
                  </td>
                  <td className="text-center px-2 font-bold">{r.lessons.length}</td>
                  <td className={`text-center px-2 font-black ${scoreColor(r.speakAvg)}`}>{r.speakAvg ?? '—'}</td>
                  <td className={`text-center px-2 font-black ${scoreColor(r.exAvg)}`}>{r.exAvg ?? '—'}</td>
                  <td className="text-center px-2 font-bold">{r.submitted}</td>
                  <td className="text-center px-2 text-xs text-slate-500 whitespace-nowrap">{fmtTime(r.lastActive)}</td>
                  <td className="px-2 text-right">
                    <button title="Xoá học sinh" onClick={e => { e.stopPropagation(); onRemove(r.sid, r.name); }} className="p-1.5 text-slate-300 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
                {expanded === r.sid && (
                  <tr className="bg-slate-50/70">
                    <td colSpan={7} className="px-4 py-3">
                      {r.lessons.length === 0 ? (
                        <p className="text-xs text-slate-400">Con chưa học bài nào.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {r.lessons.map(l => (
                            <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs bg-white rounded-xl border border-slate-100 px-3 py-2">
                              <span className="font-bold text-slate-700 min-w-[140px] flex-1">{l.topic || '(không tên)'}</span>
                              <span className="text-slate-500">{l.level}</span>
                              <span>Nói: <b className={scoreColor(l.speakingScore)}>{l.speakingScore ?? '—'}</b></span>
                              <span>Bài tập: <b className={scoreColor(l.exerciseScore)}>{l.exerciseScore ?? '—'}</b></span>
                              {l.submitted && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-black">Đã nộp</span>}
                              <span className="text-slate-400">{fmtTime(l.submittedAt || l.createdAt)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------- Giao bài nói (cô tạo bằng AI) ----------------
const AssignTab: React.FC<{
  code: string | null; data: ClassData; onError: (m: string) => void; hasKey: boolean; onNeedKey: () => void;
  classes: Record<string, { name: string; createdAt: number }>;
}> = ({ code, data, onError, hasKey, onNeedKey, classes }) => {
  const [mode, setMode] = useState<'library' | 'generate' | 'image' | 'useInput'>('library');
  const [photo, setPhoto] = useState<string | null>(null);   // ảnh cô tải lên (đã thu nhỏ)
  const [copyText, setCopyText] = useState(false);            // ảnh là trang sách → chép đúng chữ

  /** Thu nhỏ ảnh ≤ 1000px để vừa gửi AI vừa lưu kèm bài */
  const loadPhoto = (file?: File | null) => {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        setPhoto(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => onError('Chưa đọc được ảnh này, cô thử ảnh khác nhé.');
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  };
  const [input, setInput] = useState('');
  const [level, setLevel] = useState('Starters');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'gen' | 'save'>('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [withExercise, setWithExercise] = useState(false);
  const [exBusy, setExBusy] = useState(false);
  const [targets, setTargets] = useState<string[]>(code ? [code] : []);
  useEffect(() => { setTargets(code ? [code] : []); }, [code]);
  const classCodes = Object.keys(classes).sort((a, b) => (classes[b].createdAt || 0) - (classes[a].createdAt || 0));
  const toggleTarget = (c: string) => setTargets(t => (t.includes(c) ? t.filter(x => x !== c) : [...t, c]));
  const [library, setLibrary] = useState<Record<string, SavedLesson>>({});
  const [peek, setPeek] = useState<string | null>(null);
  useEffect(() => listenLibrary(setLibrary), []);
  const [sampleDone, setSampleDone] = useState<Record<string, boolean>>({});
  useEffect(() => listenSampleAudioDone(setSampleDone), []);
  const [bulk, setBulk] = useState<{ running: boolean; done: number; total: number; current?: string; msg?: string } | null>(null);
  const bulkStop = useRef(false);
  const sampleIds = Object.keys(SAMPLE_LESSONS);
  const sampleHave = sampleIds.filter(id => sampleDone[id]).length;

  /** Tạo giọng Leda cho mọi bài mẫu còn thiếu (key của cô), lần lượt từng bài */
  const runBulk = async () => {
    const useEl = getTtsProvider() === 'elevenlabs';
    // Danh sách key Gemini: key chính trước, rồi bảng key dự phòng
    const keys = useEl ? [''] : Array.from(new Set([mainKey(), ...getGeminiKeyPool()].filter(Boolean)));
    if (!useEl && !keys.length) { onNeedKey(); return; }
    const todo = sampleIds.filter(id => !sampleDone[id]);
    if (!todo.length) return;
    bulkStop.current = false;
    let done = 0, fails = 0, lastErr = '', ki = 0, i = 0;
    if (!useEl) setKeyOverride(keys[0]);
    setBulk({ running: true, done: 0, total: todo.length });
    try {
      while (i < todo.length && !bulkStop.current) {
        const id = todo[i];
        const l = SAMPLE_LESSONS[id];
        const keyNote = !useEl && keys.length > 1 ? ` · key ${ki + 1}/${keys.length}` : '';
        setBulk({ running: true, done, total: todo.length, current: `${l.level} · ${l.topic}${keyNote}` });
        const b64 = await makeLessonAudio(l.readingText, l.level).catch((e: any) => { lastErr = e?.message || ''; return null; });
        let ok = false;
        if (b64) { try { await saveSampleAudio(id, b64); ok = true; } catch { /* lỗi mạng */ } }
        if (ok) { done++; fails = 0; i++; }
        else if (!useEl && ki < keys.length - 1) {
          // key này hết lượt → sang key kế tiếp, làm lại đúng bài này
          ki++; setKeyOverride(keys[ki]); fails = 0; continue;
        } else if (++fails >= 2) {
          setBulk({ running: false, done, total: todo.length,
            msg: (lastErr ? `Tạm dừng: ${lastErr} ` : `Tạm dừng: ${keys.length > 1 ? `cả ${keys.length} key` : 'key của cô'} đều đang hết lượt tạo giọng. `) + 'Bài đã tạo được giữ lại — lúc khác cô bấm lại để làm tiếp.' });
          return;
        }
        await new Promise(res => setTimeout(res, 2500));
      }
      setBulk({ running: false, done, total: todo.length,
        msg: bulkStop.current ? 'Đã dừng. Bài đã tạo được giữ lại.' : `Xong: đã tạo giọng AI cho ${done} bài mẫu.` });
    } finally { setKeyOverride(null); }
  };
  const list = (Object.entries(data.assignments) as [string, Assignment][]).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

  const samples = Object.entries(SAMPLE_LESSONS).filter(([, l]) => l.level === level);
  const mine = (Object.entries(library) as [string, SavedLesson][])
    .filter(([, l]) => l.level === level)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  const countMine = (lv: string) => (Object.values(library) as SavedLesson[]).filter(l => l.level === lv).length;

  const [media, setMedia] = useState<'' | 'img' | 'audio'>('');

  const openLesson = (l: { topic: string; level: string; readingText: string; translation?: string; vocabulary?: VocabItem[]; image?: string; hasAudio?: boolean; exercise?: ExerciseData }, origin: Draft['origin'], id: string) => {
    setLevel(l.level);
    setSavedMsg(null);
    setDraft({
      topic: l.topic, readingText: l.readingText, translation: l.translation || '', vocabulary: l.vocabulary || [],
      image: l.image, exercise: l.exercise || null, audio: (origin === 'saved' && l.hasAudio) || (origin === 'sample' && sampleDone[id]) ? undefined : null,
      sampleAudio: origin === 'sample' && !!sampleDone[id],
      origin, libId: origin === 'saved' ? id : undefined, sampleId: origin === 'sample' ? id : undefined,
    });
    if (origin === 'sample' && sampleDone[id]) {
      fetchSampleAudio(id).then(b64 => setDraft(d => (d && d.sampleId === id ? { ...d, audio: b64 } : d))).catch(() => {});
    }
    if (origin === 'saved' && l.hasAudio) {
      fetchLibraryAudio(id).then(b64 => setDraft(d => (d && d.libId === id ? { ...d, audio: b64 } : d))).catch(() => {});
    }
    setTimeout(() => document.getElementById('assign-draft')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  /** Tạo ảnh / giọng đọc AI cho bản nháp hiện tại (key của cô); bài của cô thì lưu luôn vào kho */
  const addImage = async () => {
    if (!draft) return;
    if (!hasKey) { onNeedKey(); return; }
    const d0 = draft;
    setMedia('img');
    try {
      const img = await makeLessonImage('', d0.topic + ': ' + d0.readingText.slice(0, 200));
      if (!img) { onError('Key của cô chưa tạo được ảnh AI (key miễn phí thường không có quyền tạo ảnh). Bài vẫn giữ ảnh hiện tại.'); return; }
      setDraft(d => (d && d.readingText === d0.readingText ? { ...d, image: img } : d));
      if (d0.libId) await saveToLibrary(d0.libId, { ...d0, level, image: img, audio: undefined }, false).catch(() => {});
    } finally { setMedia(''); }
  };
  const addAudio = async () => {
    if (!draft) return;
    if (!hasKey && getTtsProvider() !== 'elevenlabs') { onNeedKey(); return; }
    const d0 = draft;
    setMedia('audio');
    try {
      const b64 = await makeLessonAudio(d0.readingText, level).catch((e: any) => { onError(e?.message || 'Chưa tạo được giọng đọc AI.'); return undefined; });
      if (b64 === undefined) return;
      if (!b64) { onError('Chưa tạo được giọng đọc AI (hết lượt hoặc key chưa hỗ trợ). Học sinh vẫn nghe bằng giọng đọc của máy.'); return; }
      const sameSample = !!d0.sampleId && SAMPLE_LESSONS[d0.sampleId]?.readingText === d0.readingText.trim();
      setDraft(d => (d && d.readingText === d0.readingText ? { ...d, audio: b64, sampleAudio: sameSample } : d));
      if (d0.libId) await saveToLibrary(d0.libId, { ...d0, level, audio: b64 }, false).catch(() => {});
      if (sameSample) await saveSampleAudio(d0.sampleId!, b64).catch(() => {});
    } finally { setMedia(''); }
  };

  const generate = async () => {
    if (!hasKey) { onNeedKey(); return; }
    if (mode === 'image' && !photo) { onError('Cô tải một bức ảnh lên trước nhé.'); return; }
    if (mode !== 'image' && !input.trim()) { onError(mode === 'generate' ? 'Cô nhập chủ đề hoặc từ vựng trước nhé.' : 'Cô dán đoạn văn tiếng Anh trước nhé.'); return; }
    setBusy('gen'); setSavedMsg(null);
    let made = false;
    try {
      const r = mode === 'image'
        ? await generateContent(input.trim() || (copyText ? 'Extract text from image' : 'A scene based on the provided image'), level as EnglishLevel, copyText ? 'useInput' : 'generate', photo || undefined)
        : await generateContent(input.trim(), level as EnglishLevel, mode === 'useInput' ? 'useInput' : 'generate');
      const lesson: { topic: string; level: string; readingText: string; translation: string; vocabulary: VocabItem[]; exercise?: ExerciseData | null } = { topic: r.topicName || input.trim().slice(0, 60) || 'Bài từ hình ảnh', level, readingText: r.readingText, translation: r.translation, vocabulary: r.vocabulary || [] };
      if (withExercise) {
        setBusy('gen');
        lesson.exercise = await generateExercise(r.readingText, level as EnglishLevel).catch(() => { onError('Bài đọc đã tạo, nhưng chưa tạo được phần bài tập. Cô bấm "+ Tạo bài tập" ở bên dưới để thử lại.'); return null; });
      }
      // Tạo đến đâu lưu đến đấy: bấm "Tạo lại" thì ghi đè bản nháp AI chưa giao, không sinh bài rác.
      const reuse = draft?.origin === 'ai' && draft.libId ? draft.libId : null;
      const lid = reuse || newLibraryId();
      made = true;
      setDraft({ ...lesson, origin: 'ai', libId: lid, image: mode === 'image' && photo && photo.length <= 400000 ? photo : undefined, audio: null });
      setTimeout(() => document.getElementById('assign-draft')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      try { await saveToLibrary(lid, { ...lesson, image: mode === 'image' && photo && photo.length <= 400000 ? photo : undefined, audio: null }, !reuse); } catch { onError('Bài đã tạo nhưng chưa lưu được vào kho (mất mạng?).'); }
      setBusy('');
      // Ảnh + giọng đọc AI tạo ngay sau bài (dùng key của cô), tự lưu vào kho
      setMedia('img');
      const img = await makeLessonImage(r.prompt, lesson.topic);
      if (img) {
        setDraft(d => (d && d.libId === lid ? { ...d, image: img } : d));
        await saveToLibrary(lid, { ...lesson, image: img }, false).catch(() => {});
      }
      setMedia('audio');
      const b64 = await makeLessonAudio(lesson.readingText, level).catch((e: any) => { onError(`Bài đã tạo, nhưng chưa tạo được giọng: ${e?.message || ''}`); return null; });
      if (b64) {
        setDraft(d => (d && d.libId === lid && d.readingText === lesson.readingText ? { ...d, audio: b64 } : d));
        await saveToLibrary(lid, { ...lesson, image: img || undefined, audio: b64 }, false).catch(() => {});
      }
    } catch (e: any) {
      if (!made) onError(friendlyAiError(e));
    } finally { setBusy(''); setMedia(''); }
  };

  const assign = async () => {
    if (!draft) return;
    if (!classCodes.length) { onError('Cô tạo lớp trước (ô Tạo lớp mới) rồi mới giao bài được nhé. Bài trong kho vẫn giữ nguyên.'); return; }
    if (!targets.length) { onError('Cô tích chọn ít nhất một lớp để giao bài nhé.'); return; }
    if (!draft.readingText.trim()) { onError('Bài đọc đang trống.'); return; }
    setBusy('save');
    try {
      for (const c of targets) {
        await addAssignment(c, draft.topic, level, note, { ...draft, audio: draft.audio || null });
      }
      // Cập nhật kho: bài của cô lưu cả phần cô sửa; bài mẫu cô đã sửa thì lưu thành bài mới của cô.
      try {
        const lesson = { ...draft, level };
        if (draft.libId) {
          await saveToLibrary(draft.libId, lesson, false);
          await markLibraryUsed(draft.libId, library[draft.libId]?.usedCount || 0);
        } else if (draft.sampleId) {
          const s = SAMPLE_LESSONS[draft.sampleId];
          if (s && (s.readingText !== draft.readingText.trim() || s.topic !== draft.topic.trim() || s.translation !== draft.translation.trim() || (!!draft.audio && !draft.sampleAudio))) {
            const lid = newLibraryId();
            await saveToLibrary(lid, { ...lesson, audio: draft.audio || null }, true);
            await markLibraryUsed(lid, 0);
          }
        }
      } catch { /* lỗi lưu kho không chặn việc giao bài */ }
      const names = targets.map(c => classes[c]?.name || c).join(', ');
      setDraft(null); setInput(''); setNote('');
      setSavedMsg(`Đã giao bài cho ${targets.length > 1 ? `${targets.length} lớp (${names})` : `lớp ${names}`}. Học sinh mở app là thấy ngay, không cần API key.`);
    } catch (e: any) { onError(e.message); } finally { setBusy(''); }
  };

  /** Lưu bản nháp (kể cả phần cô đã sửa) vào Kho bài chung — không cần giao cho lớp nào. */
  const saveDraft = async (quiet = false) => {
    if (!draft || !draft.readingText.trim()) return false;
    try {
      const audio = draft.audio === undefined ? undefined : (draft.audio || null);
      const lesson = { topic: draft.topic, level, readingText: draft.readingText, translation: draft.translation, vocabulary: draft.vocabulary, image: draft.image, audio, exercise: draft.exercise === undefined ? undefined : (draft.exercise || null) };
      if (draft.libId) {
        await saveToLibrary(draft.libId, lesson, false);
        if (!quiet) setSavedMsg(`Đã lưu "${draft.topic}" vào Kho bài (trình độ ${level}).`);
      } else if (draft.sampleId) {
        const s0 = SAMPLE_LESSONS[draft.sampleId];
        const changed = !s0 || s0.readingText !== draft.readingText.trim() || s0.topic !== draft.topic.trim() || s0.translation !== draft.translation.trim() || (!!draft.audio && !draft.sampleAudio);
        if (!changed) { if (!quiet) setSavedMsg('Bài mẫu này đã có sẵn trong Kho bài. Cô sửa nội dung rồi bấm lưu thì sẽ thành bài riêng của cô.'); return true; }
        const lid = newLibraryId();
        await saveToLibrary(lid, lesson, true);
        setDraft(d => (d ? { ...d, origin: 'saved', libId: lid, sampleId: undefined } : d));
        if (!quiet) setSavedMsg(`Đã lưu bản sửa "${draft.topic}" thành bài riêng của cô trong Kho bài (trình độ ${level}).`);
      }
      return true;
    } catch { onError('Chưa lưu được vào Kho bài (mất mạng?). Cô thử lại nhé.'); return false; }
  };
  const closeDraft = async () => {
    if (draft && draft.origin !== 'sample') await saveDraft(true); // đóng bảng thì phần cô sửa vẫn được giữ lại
    setDraft(null);
  };

  const draftAudio = draft?.audio;
  const draftLoadAudio = useMemo(() => (draftAudio ? async () => draftAudio : undefined), [draftAudio]);
  const peekLoaders = useRef<Record<string, () => Promise<string | null>>>({});
  const peekLoader = (id: string) => (peekLoaders.current[id] ||= () => fetchLibraryAudio(id));
  const samplePeekLoader = (id: string) => (peekLoaders.current['S' + id] ||= () => fetchSampleAudio(id));

  const exerciseChooser = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {([[false, '📄 Bài đọc như bài mẫu', 'Bài đọc + bản dịch + từ vựng (nhanh, nhẹ).'],
         [true, '🧩 Bài AI thiết kế đầy đủ', 'Bài đọc + 30 câu bài tập (trắc nghiệm, dịch, sắp xếp câu, tìm lỗi, điền từ).']] as const).map(([v, t, d]) => (
        <button type="button" key={String(v)} onClick={() => setWithExercise(v)}
          className={`text-left p-3 rounded-2xl border-2 ${withExercise === v ? 'border-brand-green bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-200'}`}>
          <p className="font-black text-sm text-slate-800">{t}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{d}</p>
        </button>
      ))}
    </div>
  );

  const addExercise = async () => {
    if (!draft) return;
    if (!hasKey) { onNeedKey(); return; }
    const d0 = draft;
    setExBusy(true);
    try {
      const ex = await generateExercise(d0.readingText, level as EnglishLevel);
      setDraft(d => (d && d.readingText === d0.readingText ? { ...d, exercise: ex } : d));
      if (d0.libId) await saveToLibrary(d0.libId, { ...d0, level, exercise: ex, audio: undefined }, false).catch(() => {});
    } catch (e: any) { onError(friendlyAiError(e)); } finally { setExBusy(false); }
  };

  const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const lessonRow = (id: string, l: { topic: string; readingText: string; theme?: string; usedCount?: number; image?: string; hasAudio?: boolean }, origin: Draft['origin']) => (
    <li key={id} className="px-2 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setPeek(peek === id ? null : id)} className="min-w-0 text-left flex-1 flex items-center gap-3">
          {l.image ? <img src={l.image} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} className="w-14 h-10 sm:w-16 sm:h-11 rounded-lg object-cover shrink-0 bg-slate-100" />
            : <span className="w-14 h-10 sm:w-16 sm:h-11 rounded-lg bg-slate-100 shrink-0 flex items-center justify-center text-lg">📖</span>}
          <span className="min-w-0">
          <p className="font-bold text-slate-800 truncate">{l.topic}</p>
          <p className="text-xs text-slate-500 truncate">
            {origin === 'sample' ? (l.theme || 'Bài mẫu') : 'Cô đã tạo'} · {wc(l.readingText)} từ
            {l.usedCount ? ` · đã giao ${l.usedCount} lần` : ''}{l.hasAudio || (origin === 'sample' && sampleDone[id]) ? ' · 🎙️ giọng AI' : ''}{(l as any).exercise ? ' · 🧩 có bài tập' : ''}
          </p>
          <p className="text-[11px] font-bold text-blue-600">{peek === id ? '▲ Thu gọn' : '▼ Xem như học sinh'}</p>
          </span>
        </button>
        <button onClick={() => openLesson(origin === 'sample' ? SAMPLE_LESSONS[id] : library[id], origin, id)}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-brand-green text-white text-xs font-black">Xem & giao</button>
        {origin === 'saved' && (
          <button title="Xoá khỏi kho (không ảnh hưởng bài đã giao)"
            onClick={() => { if (confirm(`Xoá bài "${l.topic}" khỏi kho của cô? Bài đã giao cho lớp vẫn giữ nguyên.`)) removeFromLibrary(id); }}
            className="shrink-0 p-1.5 text-slate-300 hover:text-red-600"><Trash2 size={14} /></button>
        )}
      </div>
      {peek === id && (
        <div className="mt-3">
          <LessonCard label="Học sinh sẽ thấy" a={origin === 'sample' ? SAMPLE_LESSONS[id] : library[id]}
            loadAudio={origin === 'saved' ? (library[id]?.hasAudio ? peekLoader(id) : undefined) : (sampleDone[id] ? samplePeekLoader(id) : undefined)} />
          <div className="mt-3"><RecorderPreview /></div>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-black text-blue-600 uppercase tracking-wider">Thiết kế và giao bài cho học sinh</p>
          {!hasKey && mode !== 'library' && (
            <button onClick={onNeedKey} className="flex items-center gap-1 text-xs font-black px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800">
              <Zap size={14} /> Cô nhập API key Gemini để tạo bài
            </button>
          )}
        </div>
        <div className="flex gap-1 sm:gap-2 bg-slate-100 p-1 rounded-xl text-xs sm:text-sm">
          {([['library', '📚 Kho bài'], ['generate', '💡 Chủ đề'], ['image', '🖼️ Hình ảnh'], ['useInput', '📝 Văn bản']] as const).map(([m, label]) => (
            <button type="button" key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2 px-1 rounded-lg font-black ${mode === m ? 'bg-white shadow text-brand-green-dark' : 'text-slate-500'}`}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {LEVELS.map(l => (
            <button type="button" key={l} onClick={() => setLevel(l)} title={LEVEL_INFO[l]?.desc}
              className={`px-3 py-1.5 rounded-lg text-xs font-black border ${level === l ? 'bg-brand-green text-white border-brand-green' : 'border-slate-200 text-slate-600'}`}>
              {l}{mode === 'library' && <span className="ml-1 opacity-70">{5 + countMine(l)}</span>}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">{LEVEL_INFO[level]?.label} — {LEVEL_INFO[level]?.desc}</p>
        {mode !== 'library' && (
          <p className="text-[11px] font-bold text-blue-600">📚 Bài cô tạo xong sẽ tự lưu vào Kho bài, mục trình độ {level}.</p>
        )}
        {mode === 'library' ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-gradient-to-r from-blue-50 to-amber-50 border border-blue-100 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-black text-slate-700">🎙️ Giọng AI cho bài mẫu: <span className="text-blue-700">{sampleHave}/{sampleIds.length}</span> bài đã có</p>
                {bulk?.running ? (
                  <button onClick={() => { bulkStop.current = true; }} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-black text-slate-600">Dừng</button>
                ) : sampleHave < sampleIds.length ? (
                  <button onClick={runBulk} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-green text-white text-xs font-black">
                    <Sparkles size={14} /> Tạo giọng cho {sampleIds.length - sampleHave} bài còn thiếu
                  </button>
                ) : <span className="text-xs font-black text-blue-700">✓ Đủ cả {sampleIds.length} bài</span>}
              </div>
              <VoiceSettings />
              {bulk?.running && (
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-white overflow-hidden"><div className="h-full bg-brand-green transition-all" style={{ width: `${(bulk.done / Math.max(1, bulk.total)) * 100}%` }} /></div>
                  <p className="text-[11px] font-bold text-slate-500 flex items-center gap-1"><RefreshCw size={12} className="animate-spin" /> {bulk.done}/{bulk.total} · đang tạo: {bulk.current}</p>
                </div>
              )}
              {bulk?.msg && !bulk.running && <p className="text-[11px] font-bold text-slate-600">{bulk.msg}</p>}
              <p className="text-[11px] text-slate-400">Tạo xong thì mọi lớp nghe giọng này, không cần tạo lại. Bài nào đã có giọng thì giữ nguyên.</p>
            </div>
            <div className="rounded-2xl border-2 border-blue-200 bg-blue-50/40 px-3 py-2.5">
              <p className="text-sm font-black text-brand-green-dark">📚 Kho bài — trình độ {level} ({samples.length + mine.length} bài)</p>
              <p className="text-[11px] text-slate-500">Kho chia theo trình độ: bấm tên trình độ ở trên để đổi. Gồm bài mẫu chuẩn và bài cô tự tạo.</p>
            </div>
            <div className="rounded-2xl border border-blue-100">
              <p className="px-3 pt-2.5 text-[11px] font-black text-blue-700 uppercase tracking-wider">⭐ Bài mẫu chuẩn — {level} ({samples.length})</p>
              <ul className="divide-y divide-slate-100 px-1">
                {samples.map(([id, l]) => lessonRow(id, l, 'sample'))}
              </ul>
            </div>
            <div className="rounded-2xl border border-amber-100">
              <p className="px-3 pt-2.5 text-[11px] font-black text-amber-700 uppercase tracking-wider">✍️ Bài cô đã tạo — {level} ({mine.length})</p>
              {mine.length === 0 ? (
                <p className="px-3 py-3 text-xs text-slate-400">Chưa có bài trình độ này. Mỗi bài cô tạo ở tab Chủ đề, Hình ảnh hoặc Văn bản sẽ tự lưu vào đây để dùng lại cho lớp khác.</p>
              ) : (
                <ul className="divide-y divide-slate-100 px-1">
                  {mine.map(([id, l]) => lessonRow(id, l, 'saved'))}
                </ul>
              )}
            </div>
            <p className="text-[11px] text-slate-400">Giao bài từ kho không cần API key. Bài mẫu soạn theo chủ đề và độ khó của Cambridge YLE (Starters–Flyers) và CEFR (A1–B2).</p>
          </div>
        ) : mode === 'generate' ? (
          <div className="space-y-3">
            {exerciseChooser}
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Chủ đề hoặc từ vựng, VD: My family; cake, picture, seven"
              className="w-full px-3 py-2.5 text-sm border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
          </div>
        ) : mode === 'image' ? (
          <div className="space-y-3">
            {exerciseChooser}
            <label className="block rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-4 text-center cursor-pointer hover:bg-blue-50">
              <input type="file" accept="image/*" className="hidden" onChange={e => { loadPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              {photo ? <img src={photo} alt="Ảnh đã chọn" className="mx-auto max-h-56 rounded-xl" />
                : <span className="text-sm font-bold text-slate-500">🖼️ Bấm để tải ảnh lên (tranh minh hoạ hoặc trang sách)</span>}
              {photo && <span className="block mt-2 text-[11px] font-bold text-blue-600">Bấm để đổi ảnh khác</span>}
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={copyText} onChange={e => setCopyText(e.target.checked)} className="w-4 h-4 accent-blue-600" />
              Ảnh là trang sách — chép đúng nguyên văn chữ trong ảnh
            </label>
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Gợi ý chủ đề (không bắt buộc)"
              className="w-full px-3 py-2.5 text-sm border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
          </div>
        ) : (
          <div className="space-y-3">
            {exerciseChooser}
          <textarea value={input} onChange={e => setInput(e.target.value)} rows={5} placeholder="Dán đoạn văn tiếng Anh cô muốn học sinh đọc (giữ nguyên từng chữ)"
            className="w-full px-3 py-2.5 text-sm border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
          </div>
        )}
        {mode !== 'library' && (
          <button onClick={generate} disabled={!!busy}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-brand-green text-white font-black text-sm disabled:opacity-60">
            {busy === 'gen' ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy === 'gen' ? 'AI đang soạn bài...' : draft?.origin === 'ai' ? 'Tạo lại bài khác' : 'Tạo bài bằng AI'}
          </button>
        )}
        {savedMsg && <p className="text-sm font-bold text-blue-700 flex items-center gap-1"><Check size={16} /> {savedMsg}</p>}
      </div>

      {draft && (
        <div id="assign-draft" className="bg-white rounded-3xl shadow-xl border-4 border-amber-200 p-4 sm:p-5 space-y-3 scroll-mt-24">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black text-amber-700 uppercase tracking-wider">Xem lại và sửa trước khi giao · {level}</p>
            <span className="text-[11px] font-black px-2 py-1 rounded-full bg-blue-50 text-blue-700">
              {draft.origin === 'sample' ? '⭐ Bài mẫu chuẩn' : '✓ Đã lưu vào Kho bài chung'}
            </span>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-black text-slate-500 uppercase">👀 Học sinh sẽ thấy bài như thế này</p>
            <LessonCard label="Học sinh sẽ thấy" a={{ ...draft, level }} loadAudio={draftLoadAudio} />
            <RecorderPreview />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 border border-slate-100 p-3 text-xs">
            <span className={`px-2.5 py-1 rounded-full font-black ${draft.image ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>
              {draft.image ? '🖼️ Có ảnh' : '🖼️ Chưa có ảnh'}
            </span>
            <span className={`px-2.5 py-1 rounded-full font-black ${draft.audio ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>
              {draft.audio ? '🎙️ Giọng AI' : draft.audio === undefined ? '🎙️ Đang tải giọng đọc…' : '🔈 Giọng đọc của máy'}
            </span>
            <span className={`px-2.5 py-1 rounded-full font-black ${draft.exercise ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}>
              {draft.exercise ? '🧩 Có 30 câu bài tập' : '🧩 Chưa có bài tập'}
            </span>
            {exBusy ? (
              <span className="flex items-center gap-1 font-black text-blue-700"><RefreshCw size={14} className="animate-spin" /> Đang tạo bài tập…</span>
            ) : draft.exercise ? (
              <button onClick={() => setDraft({ ...draft, exercise: null })} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-black text-slate-500">Bỏ bài tập</button>
            ) : (
              <button onClick={addExercise} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-black text-slate-700 hover:border-blue-300">+ Tạo bài tập (AI)</button>
            )}
            {media ? (
              <span className="flex items-center gap-1 font-black text-blue-700"><RefreshCw size={14} className="animate-spin" />
                {media === 'img' ? 'Đang tạo ảnh bằng key của cô…' : 'Đang tạo giọng đọc AI…'}</span>
            ) : (
              <>
                <button onClick={addImage} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-black text-slate-700 hover:border-blue-300">
                  {draft.image ? 'Tạo ảnh khác (AI)' : '+ Tạo ảnh (AI)'}</button>
                {draft.sampleId && draft.image !== SAMPLE_LESSONS[draft.sampleId]?.image && (
                  <button onClick={() => setDraft({ ...draft, image: SAMPLE_LESSONS[draft.sampleId!]?.image })} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-black text-slate-700">Dùng ảnh gốc</button>
                )}
                {draft.image && <button onClick={() => setDraft({ ...draft, image: undefined })} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-black text-slate-500">Bỏ ảnh</button>}
                {draft.audio !== undefined && (
                  <button onClick={addAudio} className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-black text-slate-700 hover:border-blue-300">
                    {draft.audio ? 'Tạo lại giọng AI' : '+ Tạo giọng AI'}</button>
                )}
              </>
            )}
            <span className="basis-full text-[11px] text-slate-400">Ảnh dùng key Gemini; giọng AI dùng nguồn cô chọn trong Kho bài (Leda hoặc ElevenLabs). Không có giọng AI thì học sinh nghe bằng giọng đọc có sẵn của máy.</span>
          </div>
          <details className="rounded-2xl border border-slate-100 px-3 py-2 group" open={draft.origin === 'ai'}>
            <summary className="cursor-pointer text-[11px] font-black text-slate-500 uppercase py-1">✏️ Sửa nội dung bài</summary>
            <div className="space-y-3 pt-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-black text-slate-500 uppercase">Tên bài</span>
            <input value={draft.topic} onChange={e => setDraft({ ...draft, topic: e.target.value })}
              className="w-full px-3 py-2 text-sm font-bold border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-black text-slate-500 uppercase">Bài đọc học sinh sẽ đọc to</span>
            <textarea value={draft.readingText} onChange={e => setDraft({ ...draft, readingText: e.target.value, audio: draft.audio ? null : draft.audio, sampleAudio: false })} rows={6}
              className="w-full px-3 py-2 text-base leading-relaxed border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-black text-slate-500 uppercase">Bản dịch tiếng Việt</span>
            <textarea value={draft.translation} onChange={e => setDraft({ ...draft, translation: e.target.value })} rows={3}
              className="w-full px-3 py-2 text-sm border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
          </label>
          {draft.vocabulary.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {draft.vocabulary.map((v, i) => (
                <span key={i} className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-100">
                  {v.emoji} <b>{v.word}</b> {v.ipa && <span className="text-slate-400">{v.ipa}</span>} — {v.meaning}
                </span>
              ))}
            </div>
          )}
            </div>
          </details>
          <div className="rounded-2xl border-2 border-blue-100 bg-blue-50/50 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-black text-blue-700 uppercase tracking-wider">📤 Giao cho lớp nào?</p>
              {classCodes.length > 1 && (
                <button type="button" onClick={() => setTargets(targets.length === classCodes.length ? [] : classCodes)}
                  className="text-[11px] font-black text-blue-600 hover:underline">
                  {targets.length === classCodes.length ? 'Bỏ chọn hết' : 'Chọn tất cả các lớp'}
                </button>
              )}
            </div>
            {classCodes.length === 0 ? (
              <p className="text-xs text-slate-500">Cô chưa có lớp nào. Tạo lớp ở ô "Tạo lớp mới" rồi quay lại giao bài.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {classCodes.map(c => (
                  <label key={c} className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 cursor-pointer text-sm font-bold ${
                    targets.includes(c) ? 'bg-white border-brand-green text-brand-green-dark' : 'bg-white border-slate-200 text-slate-600'}`}>
                    <input type="checkbox" checked={targets.includes(c)} onChange={() => toggleTarget(c)} className="w-4 h-4 accent-blue-600" />
                    {classes[c].name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Lời nhắn cho học sinh (không bắt buộc), VD: Hạn nộp tối thứ Năm"
            className="w-full px-3 py-2.5 text-sm border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
          <div className="flex flex-wrap gap-2">
            <button onClick={assign} disabled={!!busy} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-green text-white font-black text-sm disabled:opacity-60">
              {busy === 'save' ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />} {!classCodes.length ? 'Giao bài (cần tạo lớp trước)' : targets.length > 1 ? `Giao bài cho ${targets.length} lớp` : 'Giao bài cho lớp'}
            </button>
            <button onClick={() => saveDraft()} disabled={!!busy} className="px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 font-black text-sm hover:bg-blue-100 disabled:opacity-60">📚 Chỉ lưu vào Kho bài</button>
            <button onClick={closeDraft} className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-black text-sm">Đóng</button>
          </div>
        </div>
      )}

      {code && (

      <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-3">
        <p className="px-2 pt-1 pb-2 text-xs font-black text-blue-600 uppercase tracking-wider">Bài đã giao ({list.length})</p>
        {list.length === 0 ? (
          <p className="text-sm text-slate-400 p-3">Chưa giao bài nào.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map(([id, a]) => {
              const subs = Object.values(data.submissions[id] || {}) as Submission[];
              return (
                <li key={id} className="flex items-center justify-between gap-3 px-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 truncate">{a.topic} <span className="text-xs font-black text-blue-600 ml-1">{a.level}</span></p>
                    <p className="text-xs text-slate-500 truncate">
                      {a.readingText ? `${subs.length} bài nộp · ${subs.filter(s => s.status === 'graded').length} đã chấm` : 'Chỉ giao chủ đề (HS tự tạo bài, cần API key riêng)'}
                      {a.note ? ` · ${a.note}` : ''}
                    </p>
                  </div>
                  <button title="Xoá bài (xoá cả bài nộp)"
                    onClick={() => { if (confirm(`Xoá bài "${a.topic}" và toàn bộ bài nộp của bài này?`)) removeAssignment(code, id); }}
                    className="p-1.5 text-slate-300 hover:text-red-600"><Trash2 size={14} /></button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}
    </div>
  );
};

// ---------------- Chấm bài & báo cáo ----------------
const GradeTab: React.FC<{
  code: string; className: string; data: ClassData; hasKey: boolean; onNeedKey: () => void; callName: string;
  autoGrade: boolean; setAutoGrade: (v: boolean) => void; gradingKey: string | null; gradeError: string | null;
  onGrade: (aid: string, sid: string) => void; onRetry: (aid: string, sid: string) => void;
}> = (p) => {
  const [report, setReport] = useState<{ aid: string; sid: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(p.callName);
  useEffect(() => setNameDraft(p.callName), [p.callName]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const rows = useMemo(() => {
    const out: { aid: string; sid: string; a: Assignment; s: Submission }[] = [];
    Object.entries(p.data.submissions || {}).forEach(([aid, bySid]) => {
      const a = p.data.assignments[aid];
      if (!a) return;
      Object.entries(bySid || {}).forEach(([sid, s]) => out.push({ aid, sid, a, s: s as Submission }));
    });
    return out.sort((x, y) => (y.s.submittedAt || 0) - (x.s.submittedAt || 0));
  }, [p.data]);

  const listen = async (aid: string, sid: string) => {
    const k = `${aid}/${sid}`;
    setPlaying(k);
    try {
      const b64 = await fetchRecording(p.code, aid, sid);
      if (!b64) throw new Error('none');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
    } catch { setPlaying(null); alert('Không tải được file ghi âm.'); }
  };

  const open = report ? rows.find(r => r.aid === report.aid && r.sid === report.sid) : null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={p.autoGrade} onChange={e => p.setAutoGrade(e.target.checked)} className="w-4 h-4 accent-blue-600" />
            Tự động chấm bài mới khi cô mở bảng này
          </label>
          {!p.hasKey && (
            <button onClick={p.onNeedKey} className="flex items-center gap-1 text-xs font-black px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800">
              <Zap size={14} /> Nhập API key để chấm
            </button>
          )}
        </div>
        {!p.autoGrade && rows.some(r => r.s.status === 'pending') && (
          <button onClick={() => p.setAutoGrade(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-green text-white font-black text-sm hover:brightness-110">
            <ClipboardCheck size={16} /> Chấm lần lượt tất cả bài đang chờ
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold text-slate-500">Xưng hô trong lời nhận xét:</span>
          <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} className="w-32 px-2 py-1.5 border-2 border-blue-100 rounded-lg text-sm font-bold" />
          {nameDraft.trim() !== p.callName && (
            <button onClick={() => saveCallName(nameDraft)} className="px-3 py-1.5 rounded-lg bg-brand-green text-white text-xs font-black">Lưu</button>
          )}
        </div>
        {p.gradingKey && (
          <p className="text-sm font-bold text-blue-700 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Đang chấm bài của {p.data.submissions[p.gradingKey.split('/')[0]]?.[p.gradingKey.split('/')[1]]?.name}...</p>
        )}
        {p.gradeError && <p className="text-sm font-bold text-red-600 flex items-start gap-1.5"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {p.gradeError}</p>}
        <p className="text-[11px] text-slate-400">Bài được chấm trên máy của cô bằng API key của cô; key không gửi cho học sinh.</p>
      </div>

      {audioUrl && (
        <div className="bg-white rounded-2xl shadow border border-blue-100 p-3 flex items-center gap-3">
          <span className="text-xs font-black text-slate-500 shrink-0">🎧 {playing && p.data.submissions[playing.split('/')[0]]?.[playing.split('/')[1]]?.name}</span>
          <audio src={audioUrl} controls autoPlay className="w-full h-9" />
        </div>
      )}

      <div className="bg-white rounded-3xl shadow-xl border-4 border-blue-100 overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 p-6 text-center">Chưa có bài nộp. Khi học sinh nộp bài cô giao, bài sẽ hiện ở đây.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map(({ aid, sid, a, s }) => {
              const k = `${aid}/${sid}`;
              return (
                <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-800 truncate">{s.name}</p>
                    <p className="text-xs text-slate-500 truncate">{a.topic} · {a.level} · {fmtTime(s.submittedAt)}{s.duration ? ` · ${Math.round(s.duration)}s` : ''}</p>
                  </div>
                  {s.status === 'graded' && s.result ? (
                    <span className={`text-lg font-black ${scoreColor(s.result.isSilent ? 0 : s.result.score)}`}>{s.result.isSilent ? 'Im lặng' : s.result.score.toFixed(1)}</span>
                  ) : s.status === 'error' ? (
                    <span className="text-xs font-black text-red-600" title={s.error}>Lỗi chấm</span>
                  ) : (
                    <span className="text-xs font-black px-2 py-1 rounded-full bg-amber-100 text-amber-800">{p.gradingKey === k ? 'Đang chấm…' : 'Chờ chấm'}</span>
                  )}
                  <div className="flex items-center gap-1">
                    <button onClick={() => listen(aid, sid)} title="Nghe bài đọc" className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"><Play size={16} /></button>
                    {s.status === 'graded' && s.result ? (
                      <button onClick={() => setReport({ aid, sid })} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-brand-green text-white text-xs font-black">
                        <FileText size={14} /> Báo cáo
                      </button>
                    ) : null}
                    {(s.status === 'error' || s.status === 'graded') && (
                      <button onClick={() => p.onRetry(aid, sid)} title="Chấm lại" className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"><RefreshCw size={16} /></button>
                    )}
                    {s.status === 'pending' && !p.autoGrade && (
                      <button onClick={() => (p.hasKey ? p.onGrade(aid, sid) : p.onNeedKey())} disabled={!!p.gradingKey}
                        className="px-3 py-2 rounded-lg bg-brand-green text-white text-xs font-black disabled:opacity-50">Chấm</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {open && open.s.result && (
        <ReportModal
          code={p.code} aid={open.aid} sid={open.sid}
          studentName={open.s.name} className={p.className} lessonTopic={open.a.topic} level={open.a.level}
          result={open.s.result} report={open.s.report || ''} callName={p.callName} gradedAt={open.s.gradedAt}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  );
};


// ---------------- Đổi mật khẩu ----------------
const ChangePasswordModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={async e => {
          e.preventDefault(); setBusy(true);
          try { await changeTeacherPassword(oldP, newP); setMsg({ ok: true, text: 'Đã đổi mật khẩu. Lần sau cô dùng mật khẩu mới nhé.' }); setOldP(''); setNewP(''); }
          catch (err: any) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
        }}
        className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-black text-brand-green-dark">Đổi mật khẩu giáo viên</h3>
          <button type="button" onClick={onClose}><X size={18} /></button>
        </div>
        <input type="password" value={oldP} onChange={e => setOldP(e.target.value)} placeholder="Mật khẩu hiện tại" autoComplete="current-password"
          className="w-full px-3 py-2.5 text-sm border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
        <input type="password" value={newP} onChange={e => setNewP(e.target.value)} placeholder="Mật khẩu mới (ít nhất 6 ký tự)" autoComplete="new-password"
          className="w-full px-3 py-2.5 text-sm border-2 border-blue-100 rounded-xl focus:outline-none focus:border-brand-green" />
        {msg && <p className={`text-sm font-bold ${msg.ok ? 'text-blue-600' : 'text-red-600'}`}>{msg.text}</p>}
        <button disabled={busy} className="w-full py-2.5 rounded-xl bg-brand-green text-white font-black disabled:opacity-60">Lưu mật khẩu mới</button>
      </form>
    </div>
  );
};
