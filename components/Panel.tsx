'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { downloadCSV, normalize, parseCSV } from '@/lib/utils';
import * as XLSX from 'xlsx';

type SessionUser = { email: string; rol: string } | null;

type PadronRow = {
  id: number;
  cedula: string;
  nombres: string;
  apellidos: string;
  distrito: string;
  departamento: string;
  mesa: string;
  local: string;
  seccion: string;
};

type UsuarioRow = {
  id: string;
  email: string;
  rol: string;
  creado_en?: string;
};

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '595971689613';

export default function Panel() {
  const [sessionUser, setSessionUser] = useState<SessionUser>(null);
  const [email, setEmail] = useState('lc3storeonline@gmail.com');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loadingLogin, setLoadingLogin] = useState(false);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'padron' | 'usuarios' | 'estadisticas' | 'seguridad'>('dashboard');
  const [padron, setPadron] = useState<PadronRow[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([]);
  const [search, setSearch] = useState('');
  const [mesaFilter, setMesaFilter] = useState('todas');
  const [loadingPadron, setLoadingPadron] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('operador');
  const [resetEmail, setResetEmail] = useState('');
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editingData, setEditingData] = useState<Partial<PadronRow>>({});

  useEffect(() => {
    const saved = localStorage.getItem('session_admin_padron');
    if (saved) setSessionUser(JSON.parse(saved));
  }, []);

  useEffect(() => {
    if (sessionUser) {
      fetchPadron();
      fetchUsuarios();
    }
  }, [sessionUser]);

  async function login() {
    setLoadingLogin(true);
    setLoginError('');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoginError(error.message);
      setLoadingLogin(false);
      return;
    }
    const userEmail = data.user?.email || '';
    const { data: profile } = await supabase.from('usuarios').select('*').eq('email', userEmail).maybeSingle();
    const user = { email: userEmail, rol: profile?.rol || 'operador' };
    localStorage.setItem('session_admin_padron', JSON.stringify(user));
    setSessionUser(user);
    setLoadingLogin(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    localStorage.removeItem('session_admin_padron');
    setSessionUser(null);
  }

  async function fetchPadron() {
    setLoadingPadron(true);
    const { data } = await supabase.from('padron').select('*').order('id', { ascending: false }).limit(1000);
    setPadron((data as PadronRow[]) || []);
    setLoadingPadron(false);
  }

  async function fetchUsuarios() {
    const { data } = await supabase.from('usuarios').select('*').order('creado_en', { ascending: false });
    setUsuarios((data as UsuarioRow[]) || []);
  }

  const isAdmin = sessionUser?.rol === 'admin' || sessionUser?.rol === 'admin_general';

  const mesas = useMemo(() => {
    const unique = [...new Set(padron.map((item) => item.mesa).filter(Boolean))];
    return unique.sort((a, b) => Number(a) - Number(b));
  }, [padron]);

  const filteredPadron = useMemo(() => {
    const query = normalize(search);
    return padron.filter((item) => {
      const fullName = normalize(`${item.nombres || ''} ${item.apellidos || ''}`);
      const cedula = normalize(item.cedula || '');
      const mesaOk = mesaFilter === 'todas' || (item.mesa || '') === mesaFilter;
      const queryOk = !query || fullName.includes(query) || cedula.includes(query);
      return mesaOk && queryOk;
    });
  }, [padron, search, mesaFilter]);

  const stats = useMemo(() => ({
    total: padron.length,
    mesasCount: new Set(padron.map((p) => p.mesa).filter(Boolean)).size,
    localesCount: new Set(padron.map((p) => p.local).filter(Boolean)).size,
    usuariosCount: usuarios.length
  }), [padron, usuarios]);

  const topMesas = useMemo(() => {
    const counter: Record<string, number> = {};
    padron.forEach((item) => {
      if (!item.mesa) return;
      counter[item.mesa] = (counter[item.mesa] || 0) + 1;
    });
    return Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [padron]);

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    let rows: any[] = [];
    if (file.name.toLowerCase().endsWith('.csv')) {
      const text = await file.text();
      rows = parseCSV(text);
    } else if (file.name.toLowerCase().endsWith('.xls') || file.name.toLowerCase().endsWith('.xlsx')) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
      rows = json.map((row) => ({
        cedula: row.cedula || row.CEDULA || row.CI || row.Documento || '',
        nombres: row.nombres || row.NOMBRES || row.Nombre || '',
        apellidos: row.apellidos || row.APELLIDOS || row.Apellido || '',
        distrito: row.distrito || row.DISTRITO || 'Ybytymi',
        departamento: row.departamento || row.DEPARTAMENTO || 'Paraguari',
        mesa: String(row.mesa || row.MESA || ''),
        local: row.local || row.LOCAL || row.local_votacion || '',
        seccion: row.seccion || row.SECCION || ''
      }));
    } else {
      alert('Formato no soportado. Usa CSV, XLS o XLSX.');
      return;
    }

    if (!rows.length) return alert('No se encontraron registros para importar.');

    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from('padron').insert(batch);
      if (error) return alert(error.message);
    }

    alert('Base cargada correctamente.');
    fetchPadron();
  }

  async function createPerfil() {
    if (!newUserEmail) return alert('Ingresá un email.');
    if (!isAdmin) return alert('Solo administrador.');
    const { error } = await supabase.from('usuarios').upsert([{ email: newUserEmail, rol: newUserRole }], { onConflict: 'email' });
    if (error) return alert(error.message);
    alert('Perfil creado. Crear también el usuario en Supabase Auth.');
    setNewUserEmail('');
    setNewUserRole('operador');
    fetchUsuarios();
  }

  async function deleteUsuario(id: string) {
    if (!isAdmin) return;
    const { error } = await supabase.from('usuarios').delete().eq('id', id);
    if (error) return alert(error.message);
    fetchUsuarios();
  }

  function startEdit(row: PadronRow) {
    setEditingRow(row.id);
    setEditingData({ ...row });
  }

  async function saveEdit() {
    const { id, ...payload } = editingData as PadronRow;
    const { error } = await supabase.from('padron').update(payload).eq('id', id);
    if (error) return alert(error.message);
    setEditingRow(null);
    setEditingData({});
    fetchPadron();
  }

  async function deletePadronRow(id: number) {
    if (!isAdmin) return;
    const { error } = await supabase.from('padron').delete().eq('id', id);
    if (error) return alert(error.message);
    fetchPadron();
  }

  function sendWhatsApp(row: PadronRow) {
    const text = `Hola. Tu consulta de padrón indica: ${row.nombres} ${row.apellidos}, mesa ${row.mesa || '-'}, local ${row.local || '-'}.`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, '_blank');
  }

  async function sendResetPassword() {
    if (!resetEmail) return alert('Ingresá un email.');
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, { redirectTo: window.location.origin });
    if (error) return alert(error.message);
    alert('Correo enviado.');
    setResetEmail('');
  }

  if (!sessionUser) {
    return (
      <div className="page">
        <div className="container" style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <span className="badge red">Panel Admin Avanzado</span>
              <h1 style={{ margin: '16px 0 8px', fontSize: 30, fontWeight: 900 }}>Padrón ANR - HC Ybytymi</h1>
              <p style={{ color: '#64748b' }}>Acceso con email y permisos por rol.</p>
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label className="label">Email</label>
                <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label">Contraseña</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {loginError ? <div className="notice">{loginError}</div> : null}
              <button className="button red" onClick={login} disabled={loadingLogin}>{loadingLogin ? 'Ingresando...' : 'Ingresar'}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <section className="header">
          <div className="badges">
            <span className="badge red">Panel Admin Avanzado</span>
            <span className="badge soft">{sessionUser.rol}</span>
            <span className="badge soft">{sessionUser.email}</span>
          </div>
          <h1 className="title">PADRÓN ANR - HC YBYTYMI</h1>
          <p className="subtitle">Producción con Next.js + Supabase + importación CSV/XLS/XLSX.</p>
          <div style={{ marginTop: 16 }}>
            <button className="button red" onClick={logout}>Salir</button>
          </div>
        </section>

        <section className="stats">
          <div className="card stat"><h3>Registros</h3><strong>{stats.total}</strong><div>Total del padrón cargado</div></div>
          <div className="card stat"><h3>Mesas</h3><strong>{stats.mesasCount}</strong><div>Mesas únicas</div></div>
          <div className="card stat"><h3>Locales</h3><strong>{stats.localesCount}</strong><div>Locales de votación</div></div>
          <div className="card stat"><h3>Usuarios</h3><strong>{stats.usuariosCount}</strong><div>Perfiles registrados</div></div>
        </section>

        <div className="tabs">
          {['dashboard','padron','usuarios','estadisticas','seguridad'].map((tab) => (
            <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab as any)}>{tab}</button>
          ))}
        </div>

        {activeTab === 'dashboard' && (
          <div className="grid grid-2">
            <div className="card section">
              <h2>Accesos rápidos</h2>
              <div className="grid grid-2" style={{ marginTop: 18 }}>
                <button className="button red" onClick={() => setActiveTab('padron')}>Buscar padrón</button>
                <button className="button outline" onClick={() => downloadCSV(filteredPadron.length ? filteredPadron : padron, 'padron_ybytymi_export.csv')}>Exportar CSV</button>
                <label className="button dark">
                  Cargar CSV/XLS/XLSX
                  <input type="file" accept=".csv,.xls,.xlsx" style={{ display: 'none' }} onChange={handleFileUpload} />
                </label>
                <button className="button green-outline" onClick={() => window.open(`https://wa.me/${WHATSAPP_NUMBER}`, '_blank')}>WhatsApp</button>
              </div>
            </div>
            <div className="card section">
              <h2>Top 10 mesas</h2>
              <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
                {topMesas.map(([mesa, total]) => (
                  <div key={mesa} style={{ display: 'flex', justifyContent: 'space-between', background: '#f8fafc', padding: 14, borderRadius: 14 }}>
                    <strong>Mesa {mesa}</strong>
                    <span>{total} registros</span>
                  </div>
                ))}
                {!topMesas.length ? <div className="empty">No hay datos suficientes.</div> : null}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'padron' && (
          <>
            <div className="card section" style={{ marginBottom: 20 }}>
              <div className="grid grid-2">
                <div>
                  <label className="label">Buscar por cédula o nombre</label>
                  <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ej. 1234567 o Juan" />
                </div>
                <div>
                  <label className="label">Filtrar por mesa</label>
                  <select className="select" value={mesaFilter} onChange={(e) => setMesaFilter(e.target.value)}>
                    <option value="todas">Todas las mesas</option>
                    {mesas.map((mesa) => <option key={mesa} value={mesa}>Mesa {mesa}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="card section table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cédula</th><th>Nombre</th><th>Mesa</th><th>Local</th><th>Sección</th><th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingPadron ? (
                    <tr><td colSpan={6}>Cargando...</td></tr>
                  ) : filteredPadron.length ? filteredPadron.slice(0, 200).map((row) => (
                    <tr key={row.id}>
                      <td>{editingRow === row.id ? <input className="input" value={editingData.cedula || ''} onChange={(e) => setEditingData({ ...editingData, cedula: e.target.value })} /> : row.cedula}</td>
                      <td>{editingRow === row.id ? <input className="input" value={`${editingData.nombres || ''} ${editingData.apellidos || ''}`.trim()} onChange={(e) => setEditingData({ ...editingData, nombres: e.target.value, apellidos: '' })} /> : `${row.nombres || ''} ${row.apellidos || ''}`}</td>
                      <td>{editingRow === row.id ? <input className="input" value={editingData.mesa || ''} onChange={(e) => setEditingData({ ...editingData, mesa: e.target.value })} /> : row.mesa}</td>
                      <td>{editingRow === row.id ? <input className="input" value={editingData.local || ''} onChange={(e) => setEditingData({ ...editingData, local: e.target.value })} /> : row.local}</td>
                      <td>{editingRow === row.id ? <input className="input" value={editingData.seccion || ''} onChange={(e) => setEditingData({ ...editingData, seccion: e.target.value })} /> : row.seccion}</td>
                      <td>
                        <div className="row-actions">
                          {editingRow === row.id ? <button className="button red" onClick={saveEdit}>Guardar</button> : <button className="button outline" onClick={() => startEdit(row)}>Editar</button>}
                          <button className="button green-outline" onClick={() => sendWhatsApp(row)}>WhatsApp</button>
                          {isAdmin ? <button className="button red" onClick={() => deletePadronRow(row.id)}>Eliminar</button> : null}
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan={6}>No hay registros.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'usuarios' && (
          <>
            <div className="card section" style={{ marginBottom: 20 }}>
              <div className="grid grid-2">
                <div>
                  <label className="label">Email</label>
                  <input className="input" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="usuario@correo.com" />
                </div>
                <div>
                  <label className="label">Rol</label>
                  <select className="select" value={newUserRole} onChange={(e) => setNewUserRole(e.target.value)}>
                    <option value="operador">Operador</option>
                    <option value="admin">Admin</option>
                    <option value="admin_general">Admin general</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <button className="button red" onClick={createPerfil}>Crear perfil</button>
                {!isAdmin ? <div className="notice">Solo administrador puede crear perfiles.</div> : null}
              </div>
            </div>
            <div className="card section table-wrap">
              <table>
                <thead><tr><th>Email</th><th>Rol</th><th>Creado</th><th style={{ textAlign: 'right' }}>Acciones</th></tr></thead>
                <tbody>
                  {usuarios.length ? usuarios.map((row) => (
                    <tr key={row.id}>
                      <td>{row.email}</td>
                      <td>{row.rol}</td>
                      <td>{row.creado_en ? new Date(row.creado_en).toLocaleString() : '-'}</td>
                      <td><div className="row-actions">{isAdmin ? <button className="button red" onClick={() => deleteUsuario(row.id)}>Eliminar</button> : null}</div></td>
                    </tr>
                  )) : <tr><td colSpan={4}>No hay usuarios registrados.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'estadisticas' && (
          <div className="grid grid-2">
            <div className="card section">
              <h2>Distribución por mesa</h2>
              <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
                {topMesas.map(([mesa, total]) => (
                  <div key={mesa}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><strong>Mesa {mesa}</strong><span>{total}</span></div>
                    <div style={{ height: 10, background: '#e2e8f0', borderRadius: 999 }}>
                      <div style={{ height: 10, width: `${Math.min((total / Math.max(stats.total, 1)) * 100 * 4, 100)}%`, background: '#dc2626', borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card section">
              <h2>Resumen</h2>
              <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
                <div>Registros: <strong>{stats.total}</strong></div>
                <div>Mesas: <strong>{stats.mesasCount}</strong></div>
                <div>Locales: <strong>{stats.localesCount}</strong></div>
                <div>Usuarios: <strong>{stats.usuariosCount}</strong></div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'seguridad' && (
          <div className="card section">
            <h2>Restablecer contraseña</h2>
            <p>Envía un correo de recuperación usando Supabase Auth.</p>
            <div className="grid grid-2" style={{ marginTop: 16 }}>
              <input className="input" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="correo@ejemplo.com" />
              <button className="button red" onClick={sendResetPassword}>Enviar correo</button>
            </div>
            <p className="notice">Para creación real de usuarios en Auth, usá Supabase Auth o una Edge Function segura.</p>
          </div>
        )}

        <div style={{ marginTop: 20 }} className="footer-note">Listo para Vercel. Recordá crear tablas, roles y usuario admin en Supabase.</div>
      </div>
    </div>
  );
}
