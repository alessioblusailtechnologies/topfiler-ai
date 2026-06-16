export function backendUrl(): string {
    let u = process.env.TOPFILER_BACKEND_URL || 'http://localhost:3100';
    // Su Render `fromService` può fornire il solo hostname (es. topfiler3-backend.onrender.com):
    // se manca lo schema lo aggiungiamo (https in produzione).
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    return u.replace(/\/+$/, '');
}
