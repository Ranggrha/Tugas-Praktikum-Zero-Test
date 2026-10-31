import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

type Role = 'admin' | 'dosen' | 'mahasiswa';
type Page = 'overview' | 'grades' | 'transcripts';

type User = {
  id: number;
  username: string;
  role: Role;
  fullName: string;
  nim?: string | null;
};

type GradeRow = {
  id: number;
  class_id: number;
  student_id: number;
  score: number;
  is_finalized?: number;
  course_code?: string;
  course_name?: string;
  student_name?: string;
};

type TranscriptRow = {
  id: number;
  student_id: number;
  class_id: number;
  score: number;
  course_code?: string;
  course_name?: string;
  student_name?: string;
};

const API_BASE = 'http://localhost:3000';

const navigation: Record<Role, { id: Page; label: string; icon: typeof LayoutDashboard }[]> = {
  admin: [
    { id: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
    { id: 'transcripts', label: 'Transkrip', icon: GraduationCap },
  ],
  dosen: [
    { id: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
    { id: 'grades', label: 'Nilai', icon: BookOpen },
  ],
  mahasiswa: [
    { id: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
    { id: 'grades', label: 'Nilai', icon: BookOpen },
    { id: 'transcripts', label: 'Transkrip', icon: GraduationCap },
  ],
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState('mahasiswa01');
  const [password, setPassword] = useState('mahasiswa123');
  const [deviceId, setDeviceId] = useState('device-mhs-01');
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptRow[]>([]);
  const [editingGradeId, setEditingGradeId] = useState<number | null>(null);
  const [editedScore, setEditedScore] = useState('');
  const [savingGradeId, setSavingGradeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<Page>('overview');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!token || !user) return;

    const loadData = async () => {
      try {
        const [gradeRes, transcriptRes] = await Promise.all([
          user.role === 'admin' ? Promise.resolve(null) : fetch(`${API_BASE}/nilai`, {
            headers: { Authorization: ['Bearer', token].join(' '), 'X-Device-ID': deviceId },
          }),
          user.role === 'dosen' ? Promise.resolve(null) : fetch(`${API_BASE}/transkrip`, {
            headers: { Authorization: `Bearer ${token}`, 'X-Device-ID': deviceId },
          }),
        ]);

        if (gradeRes && !gradeRes.ok) throw new Error('Gagal memuat data nilai.');
        if (transcriptRes && !transcriptRes.ok) throw new Error('Gagal memuat data transkrip.');
        if (gradeRes) setGrades(await gradeRes.json());
        if (transcriptRes) setTranscripts(await transcriptRes.json());
      } catch {
        setError('Gagal memuat data akademik.');
      }
    };

    loadData();
  }, [token, user, deviceId]);

  const roleTitle = useMemo(() => {
    if (user?.role === 'admin') return 'Admin Akademik';
    if (user?.role === 'dosen') return 'Dosen Pengajar';
    return 'Mahasiswa';
  }, [user]);

  const averageScore = useMemo(() => {
    if (!grades.length) return 0;
    return Math.round(grades.reduce((total, grade) => total + grade.score, 0) / grades.length);
  }, [grades]);

  const handleGradeSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || editingGradeId === null) return;

    const score = Number(editedScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setError('Nilai harus berupa angka antara 0 sampai 100.');
      return;
    }

    setSavingGradeId(editingGradeId);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/nilai/${editingGradeId}`, {
        method: 'PUT',
        headers: {
          Authorization: ['Bearer', token].join(' '),
          'X-Device-ID': deviceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ score }),
      });
      const data = await response.json();
      if (!response.ok) {
        const messages: Record<string, string> = {
          OUTSIDE_ACCESS_WINDOW: 'Pengubahan nilai hanya diizinkan pukul 07.00–21.00 WIB.',
          CLASS_ALREADY_FINALIZED: 'Nilai kelas ini sudah difinalisasi dan tidak dapat diubah.',
          CLASS_NOT_OWNED: 'Anda hanya dapat mengubah nilai pada kelas yang Anda ajar.',
        };
        throw new Error(messages[data.reason] || data.reason || 'Gagal menyimpan perubahan nilai.');
      }

      setGrades((current) => current.map((grade) => (
        grade.id === editingGradeId ? { ...grade, score: data.score } : grade
      )));
      setEditingGradeId(null);
      setEditedScore('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan nilai.');
    } finally {
      setSavingGradeId(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, deviceId }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.reason || 'Login gagal');

      setUser(data.user);
      setToken(data.accessToken);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    setGrades([]);
    setTranscripts([]);
    setEditingGradeId(null);
    setEditedScore('');
    setSavingGradeId(null);
    setActivePage('overview');
    setMenuOpen(false);
  };

  if (!user) {
    return (
      <main className="login-shell">
        <div className="login-decoration login-decoration-one" />
        <div className="login-decoration login-decoration-two" />
        <section className="login-card">
          <div className="brand-lockup">
            <div className="brand-mark"><ShieldCheck size={25} strokeWidth={2.2} /></div>
            <div>
              <span className="brand-name">SIA<span>-ZT</span></span>
              <span className="brand-caption">PORTAL AKADEMIK</span>
            </div>
          </div>

          <div className="login-heading">
            <span className="eyebrow"><Sparkles size={14} /> Akses aman, belajar nyaman</span>
            <h1>Selamat datang<br />kembali<span>.</span></h1>
            <p>Masuk ke ruang akademik digital Anda.</p>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <label>
              <span>Username</span>
              <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Masukkan username" required />
            </label>
            <label>
              <span>Password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Masukkan password" required />
            </label>
            <label>
              <span>ID Perangkat</span>
              <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="ID perangkat Anda" required />
            </label>
            {error && <div className="error-message" role="alert">{error}</div>}
            <button disabled={loading} className="primary-button login-button">
              {loading ? 'Memverifikasi...' : 'Masuk ke portal'}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="login-security"><ShieldCheck size={16} /><span>Dilindungi verifikasi Zero Trust</span><span className="security-dot" /></div>
        </section>
        <footer className="login-footer">SIA-ZT <span>·</span> Sistem Informasi Akademik</footer>
      </main>
    );
  }

  const greetingName = user.fullName.trim().split(/\s+/)[0];
  const dateLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const title = activePage === 'overview' ? 'Ringkasan' : activePage === 'grades' ? 'Nilai Akademik' : 'Transkrip';

  return (
    <div className="app-shell">
      {menuOpen && <button className="sidebar-backdrop" aria-label="Tutup menu" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><ShieldCheck size={23} strokeWidth={2.2} /></div>
          <div><span className="brand-name">SIA<span>-ZT</span></span><span className="brand-caption">RUANG AKADEMIK</span></div>
          <button className="icon-button sidebar-close" aria-label="Tutup menu" onClick={() => setMenuOpen(false)}><X size={20} /></button>
        </div>

        <div className="workspace-label">MENU UTAMA</div>
        <nav className="side-navigation" aria-label="Navigasi utama">
          {navigation[user.role].map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => { setActivePage(id); setMenuOpen(false); }} className={`nav-link ${activePage === id ? 'nav-link-active' : ''}`} aria-current={activePage === id ? 'page' : undefined}>
              <Icon size={19} strokeWidth={1.9} /><span>{label}</span>{activePage === id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="security-card">
          <div className="security-card-icon"><ShieldCheck size={19} /></div>
          <div><strong>Perangkat terlindungi</strong><span>Zero Trust aktif</span></div>
          <span className="security-dot" />
        </div>
        <button className="profile-button" onClick={handleLogout}>
          <div className="avatar">{user.fullName.charAt(0).toUpperCase()}</div>
          <div className="profile-info"><strong>{user.fullName}</strong><span>{roleTitle}</span></div>
          <LogOut size={17} className="profile-logout" />
        </button>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button menu-toggle" aria-label="Buka menu" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumb"><span>Portal</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div>
          <div className="topbar-right">
            <div className="date-display">{dateLabel}</div>
            <div className="topbar-avatar" title={user.fullName}>{user.fullName.charAt(0).toUpperCase()}</div>
            <button className="mobile-logout" onClick={handleLogout} aria-label="Keluar"><LogOut size={18} /></button>
          </div>
        </header>

        <div className="page-content">
          {error && <div className="inline-alert" role="alert">{error}<button onClick={() => setError('')} aria-label="Tutup pemberitahuan"><X size={16} /></button></div>}

          {activePage === 'overview' && (
            <>
              <section className="welcome-banner">
                <div className="welcome-copy">
                  <span className="welcome-kicker"><span className="welcome-dot" /> SEMESTER BERJALAN</span>
                  <h1>Halo, {greetingName}<span>!</span></h1>
                  <p>Semoga harimu produktif. Ini ringkasan aktivitas akademikmu.</p>
                  <button className="welcome-link" onClick={() => setActivePage(user.role === 'admin' ? 'transcripts' : 'grades')}>
                    {user.role === 'admin' ? 'Lihat semua transkrip' : 'Lihat nilai akademik'} <ArrowRight size={16} />
                  </button>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
                  <div className="art-icon"><GraduationCap size={58} strokeWidth={1.3} /></div>
                  <div className="art-sparkle sparkle-one">✦</div><div className="art-sparkle sparkle-two">✧</div>
                </div>
                <div className="welcome-index">01 <span>/ 03</span></div>
              </section>

              <section className={`stats-grid ${user.role === 'admin' ? 'stats-grid-admin' : ''}`} aria-label="Statistik akademik">
                {user.role !== 'admin' && (
                  <>
                    <article className="stat-card">
                      <div className="stat-top"><span className="stat-icon stat-icon-blue"><BookOpen size={19} /></span><span className="stat-note">Semester ini</span></div>
                      <p className="stat-label">Mata kuliah</p><div className="stat-value">{grades.length}<span> mata kuliah</span></div>
                      <div className="stat-progress"><span style={{ width: `${Math.min(grades.length * 12, 100)}%` }} /></div>
                    </article>
                    <article className="stat-card">
                      <div className="stat-top"><span className="stat-icon stat-icon-green"><Check size={19} /></span><span className="stat-note positive-note"><ArrowDownRight size={14} /> Terkini</span></div>
                      <p className="stat-label">Rata-rata nilai</p><div className="stat-value">{averageScore}<span> / 100</span></div>
                      <div className="stat-progress progress-green"><span style={{ width: `${Math.min(averageScore, 100)}%` }} /></div>
                    </article>
                  </>
                )}
                <article className="stat-card">
                  <div className="stat-top"><span className="stat-icon stat-icon-violet"><GraduationCap size={19} /></span><span className="stat-note">Akumulasi</span></div>
                  <p className="stat-label">{user.role === 'admin' ? 'Transkrip seluruh mahasiswa' : 'Data transkrip'}</p><div className="stat-value">{transcripts.length}<span> mata kuliah</span></div>
                  <div className="stat-progress progress-violet"><span style={{ width: `${Math.min(transcripts.length * 12, 100)}%` }} /></div>
                </article>
              </section>

              <section className={`content-grid ${user.role === 'admin' ? 'content-grid-admin' : ''}`}>
                {user.role !== 'admin' && <article className="panel recent-panel">
                  <div className="panel-heading">
                    <div><span className="panel-kicker">PERFORMA</span><h2>Nilai terbaru</h2></div>
                    <button className="text-link" onClick={() => setActivePage('grades')}>Lihat semua <ArrowRight size={15} /></button>
                  </div>
                  {grades.length ? (
                    <div className="recent-list">
                      {grades.slice(0, 4).map((grade, index) => (
                        <div className="recent-row" key={grade.id}>
                          <div className={`course-avatar course-avatar-${index % 3}`}><BookOpen size={17} /></div>
                          <div className="course-details"><strong>{grade.course_name || 'Mata Kuliah'}</strong><span>{grade.course_code || 'Kode belum tersedia'}</span></div>
                          <div className="grade-result"><strong>{grade.score}</strong><span>Nilai</span></div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="empty-state"><div className="empty-icon"><BookOpen size={22} /></div><strong>Belum ada nilai</strong><span>Data nilai akan muncul di sini setelah tersedia.</span></div>}
                </article>}

                <article className="panel access-panel">
                  <div className="panel-heading"><div><span className="panel-kicker">AKUN ANDA</span><h2>Info perangkat</h2></div><div className="verified-tag"><ShieldCheck size={14} /> Terverifikasi</div></div>
                  <div className="device-visual"><div className="device-ring"><ShieldCheck size={28} /></div><div><strong>Akses aman</strong><span>Perangkat Anda dikenali</span></div><span className="security-dot" /></div>
                  <div className="device-details"><span>ID perangkat</span><strong>{deviceId}</strong></div>
                  <div className="device-details"><span>Nomor induk</span><strong>{user.nim || '—'}</strong></div>
                  <div className="access-footnote"><ShieldCheck size={15} /> Sesi Anda dilindungi kebijakan Zero Trust</div>
                </article>
              </section>
            </>
          )}

          {activePage === 'grades' && (
            <section className="panel data-panel">
              <div className="panel-heading data-heading"><div><span className="panel-kicker">AKADEMIK</span><h2>Nilai akademik</h2><p>{user.role === 'dosen' ? 'Nilai mahasiswa pada kelas yang Anda ajar. Perubahan tersedia pukul 07.00–21.00 WIB.' : 'Ringkasan hasil belajar yang tercatat pada akun Anda.'}</p></div><div className="table-count">{grades.length} mata kuliah</div></div>
              {grades.length ? (
                <div className="table-wrap"><table className="academic-table"><thead><tr>{user.role === 'dosen' && <th>MAHASISWA</th>}<th>MATA KULIAH</th><th>KODE</th><th>SKOR</th><th>STATUS</th>{user.role === 'dosen' && <th>AKSI</th>}</tr></thead><tbody>
                  {grades.map((grade) => <tr key={grade.id}>
                    {user.role === 'dosen' && <td><strong>{grade.student_name || `Mahasiswa #${grade.student_id}`}</strong></td>}
                    <td><strong>{grade.course_name || 'Mata Kuliah'}</strong></td>
                    <td>{grade.course_code || '—'}</td>
                    <td>
                      {user.role === 'dosen' && editingGradeId === grade.id ? (
                        <form className="grade-edit-form" onSubmit={handleGradeSave}>
                          <input
                            aria-label={`Nilai ${grade.student_name || grade.student_id} - ${grade.course_name || grade.course_code}`}
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={editedScore}
                            onChange={(event) => setEditedScore(event.target.value)}
                            required
                          />
                          <button className="grade-action-button grade-save-button" type="submit" disabled={savingGradeId === grade.id}>
                            {savingGradeId === grade.id ? 'Menyimpan...' : 'Simpan'}
                          </button>
                          <button className="grade-action-button" type="button" disabled={savingGradeId === grade.id} onClick={() => { setEditingGradeId(null); setEditedScore(''); }}>
                            Batal
                          </button>
                        </form>
                      ) : <span className="score-pill">{grade.score}</span>}
                    </td>
                    <td><span className={`status-pill ${grade.is_finalized === 1 ? 'status-pill-finalized' : ''}`}><span /> {grade.is_finalized === 1 ? 'Difinalisasi' : 'Tersedia'}</span></td>
                    {user.role === 'dosen' && <td>
                      {grade.is_finalized === 1 ? <span className="grade-locked">Terkunci</span> : editingGradeId === grade.id ? null : (
                        <button className="grade-action-button grade-edit-button" type="button" onClick={() => { setEditingGradeId(grade.id); setEditedScore(String(grade.score)); setError(''); }}>
                          Ubah nilai
                        </button>
                      )}
                    </td>}
                  </tr>)}
                </tbody></table></div>
              ) : <div className="empty-state large-empty"><div className="empty-icon"><BookOpen size={22} /></div><strong>Belum ada data nilai</strong><span>Nilai akademik akan ditampilkan di halaman ini.</span></div>}
            </section>
          )}

          {activePage === 'transcripts' && (
            <section className="panel data-panel">
              <div className="panel-heading data-heading"><div><span className="panel-kicker">RIWAYAT AKADEMIK</span><h2>Transkrip nilai</h2><p>{user.role === 'admin' ? 'Transkrip seluruh mahasiswa.' : 'Riwayat nilai mata kuliah Anda.'}</p></div><div className="table-count">{transcripts.length} mata kuliah</div></div>
              {transcripts.length ? (
                <div className="transcript-list">{transcripts.map((transcript) => (
                  <article className="transcript-row" key={transcript.id}>
                    <div className="course-avatar course-avatar-violet"><GraduationCap size={18} /></div>
                    <div className="course-details"><strong>{transcript.course_name || 'Mata Kuliah'}</strong><span>{transcript.course_code || 'Kode belum tersedia'}{transcript.student_name ? ` · ${transcript.student_name}` : ''}</span></div>
                    <div className="transcript-score"><span>SKOR</span><strong>{transcript.score}</strong></div>
                    <ChevronDown size={17} className="transcript-chevron" />
                  </article>
                ))}</div>
              ) : <div className="empty-state large-empty"><div className="empty-icon"><GraduationCap size={22} /></div><strong>Transkrip belum tersedia</strong><span>Riwayat akademik akan ditampilkan di halaman ini.</span></div>}
            </section>
          )}

          <footer className="page-footer"><span>© {new Date().getFullYear()} SIA-ZT</span><span className="footer-divider" /><span>Sistem Informasi Akademik</span><span className="footer-secure"><ShieldCheck size={14} /> Koneksi aman</span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
