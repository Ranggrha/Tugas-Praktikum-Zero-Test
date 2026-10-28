import { useEffect, useMemo, useState } from 'react';

type Role = 'admin' | 'dosen' | 'mahasiswa';

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

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState('mahasiswa01');
  const [password, setPassword] = useState('mahasiswa123');
  const [deviceId, setDeviceId] = useState('device-mhs-01');
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user) return;

    const loadData = async () => {
      try {
        const [gradeRes, transcriptRes] = await Promise.all([
          fetch(`${API_BASE}/nilai`, {
            headers: { Authorization: `Bearer ${token}`, 'X-Device-ID': deviceId },
          }),
          fetch(`${API_BASE}/transkrip`, {
            headers: { Authorization: `Bearer ${token}`, 'X-Device-ID': deviceId },
          }),
        ]);

        if (gradeRes.ok) setGrades(await gradeRes.json());
        if (transcriptRes.ok) setTranscripts(await transcriptRes.json());
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
      if (!response.ok) {
        throw new Error(data.reason || 'Login gagal');
      }

      setUser(data.user);
      setToken(data.accessToken);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg border border-slate-200">
          <div className="mb-6">
            <p className="text-sm font-semibold text-sky-700">SIA-ZT</p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">Portal Akademik Zero Trust</h1>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Device ID</label>
              <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600" />
            </div>
            {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <button disabled={loading} className="w-full rounded-lg bg-sky-700 px-4 py-2.5 font-medium text-white disabled:opacity-60">
              {loading ? 'Masuk...' : 'Masuk'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed left-0 top-0 h-full w-64 bg-slate-900 text-white">
        <div className="p-6 border-b border-slate-700">
          <p className="text-xs uppercase tracking-[0.2em] text-sky-300">SIA-ZT</p>
          <h2 className="mt-2 text-xl font-semibold">{roleTitle}</h2>
        </div>
        <nav className="p-4 space-y-2 text-sm">
          <div className="rounded-lg bg-slate-800 px-3 py-2">Beranda</div>
          <div className="rounded-lg px-3 py-2 text-slate-300">Nilai</div>
          <div className="rounded-lg px-3 py-2 text-slate-300">Transkrip</div>
        </nav>
      </aside>

      <main className="ml-64 p-6">
        <header className="mb-6 flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
          <div>
            <p className="text-sm text-slate-500">Selamat datang</p>
            <h1 className="text-2xl font-bold text-slate-900">{user.fullName}</h1>
          </div>
          <button onClick={() => setUser(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Keluar</button>
        </header>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
            <p className="text-sm text-slate-500">Peran</p>
            <h3 className="mt-2 text-xl font-bold">{user.role}</h3>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
            <p className="text-sm text-slate-500">NIM</p>
            <h3 className="mt-2 text-xl font-bold">{user.nim || '-'}</h3>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
            <p className="text-sm text-slate-500">Device aktif</p>
            <h3 className="mt-2 text-xl font-bold">{deviceId}</h3>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Nilai</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3">Mata Kuliah</th>
                  <th className="px-4 py-3">Skor</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {grades.length ? grades.map((g) => (
                  <tr key={g.id} className="border-t border-slate-200">
                    <td className="px-4 py-3">{g.course_code} - {g.course_name}</td>
                    <td className="px-4 py-3 font-semibold">{g.score}</td>
                    <td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Tersedia</span></td>
                  </tr>
                )) : <tr><td colSpan={3} className="px-4 py-3 text-slate-500">Tidak ada data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Transkrip</h2>
          <div className="grid gap-3">
            {transcripts.length ? transcripts.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="font-medium">{t.course_code} - {t.course_name}</p>
                  <p className="text-sm text-slate-500">{t.student_name || 'Mahasiswa'}</p>
                </div>
                <span className="text-lg font-bold">{t.score}</span>
              </div>
            )) : <p className="text-slate-500">Belum ada transkrip.</p>}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
