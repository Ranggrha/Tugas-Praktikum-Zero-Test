import request from 'supertest';
import { app } from '../apps/gateway/src/app';
import { db } from '../database/db';
import { signJwt } from '../packages/shared/src/helpers';
import { config } from '../packages/shared/src/config';
import { afterEach, vi } from 'vitest';

describe('SIA-ZT security tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. valid login from registered device succeeds', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('X-Device-ID', 'device-mhs-01')
      .send({ username: 'mahasiswa01', password: 'mahasiswa123' });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).toBeTruthy();
  });

  it('2. invalid password is rejected', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('X-Device-ID', 'device-mhs-01')
      .send({ username: 'mahasiswa01', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('INVALID_CREDENTIALS');
  });

  it('3. login from unregistered device is rejected', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('X-Device-ID', 'device-unknown')
      .send({ username: 'mahasiswa01', password: 'mahasiswa123' });

    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('DEVICE_NOT_REGISTERED');
  });

  it('4. missing access token is rejected', async () => {
    const response = await request(app).get('/nilai');
    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('MISSING_TOKEN');
  });

  it('5. expired or invalid JWT is rejected', async () => {
    const expired = signJwt({ sub: '1', role: 'mahasiswa' }, '-1s');
    const response = await request(app)
      .get('/nilai')
      .set('Authorization', `Bearer ${expired}`)
      .set('X-Device-ID', 'device-mhs-01');

    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('INVALID_TOKEN');
  });

  it('6. valid JWT with mismatched device is rejected', async () => {
    const token = signJwt({ sub: '1', role: 'mahasiswa' });
    const response = await request(app)
      .get('/nilai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-other');

    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('DEVICE_NOT_REGISTERED');
  });

  it('7. student can view own grades', async () => {
    const token = signJwt({ sub: '4', role: 'mahasiswa' });
    const response = await request(app)
      .get('/nilai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-mhs-01');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.every((row: { student_id: number }) => row.student_id === 4)).toBe(true);
  });

  it('8. student cannot access another student grades', async () => {
    const token = signJwt({ sub: '4', role: 'mahasiswa' });
    const response = await request(app)
      .get('/nilai?studentId=5')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-mhs-01');

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('STUDENT_OWNERSHIP_MISMATCH');
  });

  it('9. student cannot access another student transcript', async () => {
    const token = signJwt({ sub: '4', role: 'mahasiswa' });
    const response = await request(app)
      .get('/transkrip?studentId=5')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-mhs-01');

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('STUDENT_OWNERSHIP_MISMATCH');
  });

  it('10. lecturer can view and modify grades in their own class', async () => {
    const token = signJwt({ sub: '2', role: 'dosen' });
    const gradeListResponse = await request(app)
      .get('/nilai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-dosen-01');

    expect(gradeListResponse.status).toBe(200);
    expect([...new Set(gradeListResponse.body.map((row: { class_id: number }) => row.class_id))]).toEqual([1]);

    const gradeId = db.prepare('SELECT id FROM grades WHERE class_id = 1 AND student_id = 4').get()?.id as number;
    const updateResponse = await request(app)
      .put(`/nilai/${gradeId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-dosen-01')
      .send({ score: 92 });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.success).toBe(true);
  });

  it('11. lecturer cannot modify grades in another lecturer class', async () => {
    const token = signJwt({ sub: '2', role: 'dosen' });
    const gradeId = db.prepare('SELECT id FROM grades WHERE class_id = 2 AND student_id = 6').get()?.id as number;
    const response = await request(app)
      .put(`/nilai/${gradeId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-dosen-01')
      .send({ score: 95 });

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('CLASS_NOT_OWNED');
  });

  it('12. lecturer cannot modify finalized grades', async () => {
    db.prepare('UPDATE classes SET is_finalized = 1 WHERE id = 1').run();
    const token = signJwt({ sub: '2', role: 'dosen' });
    const gradeId = db.prepare('SELECT id FROM grades WHERE class_id = 1 AND student_id = 4').get()?.id as number;
    const response = await request(app)
      .put(`/nilai/${gradeId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-dosen-01')
      .send({ score: 77 });

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('CLASS_ALREADY_FINALIZED');
  });

  it('13. grade modification is rejected outside access window', async () => {
    process.env.TEST_NOW_ISO = '2025-01-01T06:59:00+07:00';
    const token = signJwt({ sub: '2', role: 'dosen' });
    const gradeId = db.prepare('SELECT id FROM grades WHERE class_id = 1 AND student_id = 5').get()?.id as number;
    const response = await request(app)
      .put(`/nilai/${gradeId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-dosen-01')
      .send({ score: 87 });

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('OUTSIDE_ACCESS_WINDOW');
  });

  it('14. class finalization is rejected outside access window', async () => {
    process.env.TEST_NOW_ISO = '2025-01-01T21:01:00+07:00';
    const token = signJwt({ sub: '2', role: 'dosen' });
    const response = await request(app)
      .post('/nilai/classes/1/finalize')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-dosen-01');

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('OUTSIDE_ACCESS_WINDOW');
  });

  it('15. admin can view transcripts for all students', async () => {
    const token = signJwt({ sub: '1', role: 'admin' });
    const response = await request(app)
      .get('/transkrip')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-admin-01');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect([...new Set(response.body.map((row: { student_id: number }) => row.student_id))].sort()).toEqual([4, 5, 6]);
  });

  it('16. admin cannot modify grades by default', async () => {
    const token = signJwt({ sub: '1', role: 'admin' });
    const gradeId = db.prepare('SELECT id FROM grades WHERE class_id = 1 AND student_id = 4').get()?.id as number;
    const response = await request(app)
      .put(`/nilai/${gradeId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-admin-01')
      .send({ score: 88 });

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('ROLE_NOT_ALLOWED');
  });

  it('16a. admin cannot read grades through the gateway', async () => {
    const token = signJwt({ sub: '1', role: 'admin' });
    const response = await request(app)
      .get('/nilai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-admin-01');

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('ROLE_NOT_ALLOWED');
  });

  it('17. valid gateway secret without valid JWT is rejected by a service', async () => {
    const response = await request('http://localhost:3001')
      .get('/grades')
      .set('X-Gateway-Secret', config.gatewaySecret)
      .set('Authorization', 'Bearer invalid-token');
    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('INVALID_TOKEN');
  });

  it('18. direct request to a service without the gateway secret is rejected', async () => {
    const response = await request('http://localhost:3001')
      .get('/grades')
      .set('Authorization', 'Bearer invalid-token');
    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('INVALID_GATEWAY_SECRET');
  });

  it('18a. admin cannot read grades by calling the grade service directly', async () => {
    const token = signJwt({ sub: '1', role: 'admin' });
    const response = await request('http://localhost:3001')
      .get('/grades')
      .set('X-Gateway-Secret', config.gatewaySecret)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe('ROLE_NOT_ALLOWED');
  });

  it('19. a user token cannot authorize transcript synchronization', async () => {
    const token = signJwt({ sub: '4', role: 'mahasiswa' });
    const response = await request('http://localhost:3002')
      .post('/transcript/sync')
      .set('X-Gateway-Secret', config.gatewaySecret)
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 1, studentIds: [4] });
    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('INVALID_SERVICE_TOKEN');
  });

  it('20. finalization obtains a service token and synchronizes transcripts through the gateway', async () => {
    process.env.TEST_NOW_ISO = '2025-01-01T10:00:00+07:00';
    const response = await request(app)
      .post('/nilai/classes/1/finalize')
      .set('Authorization', `Bearer ${signJwt({ sub: '2', role: 'dosen' })}`)
      .set('X-Device-ID', 'device-dosen-01')
      .set('X-Gateway-Secret', config.gatewaySecret);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, finalized: true, syncStatus: 200 });
    expect(db.prepare('SELECT is_finalized FROM classes WHERE id = 1').get()).toEqual({ is_finalized: 1 });
    expect(db.prepare("SELECT COUNT(*) as count FROM audit_logs WHERE endpoint = '/auth/service' AND decision = 'ALLOW'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) as count FROM audit_logs WHERE endpoint = '/transkrip/sinkron' AND decision = 'ALLOW'").get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) as count FROM transcripts WHERE class_id = 1').get()).toEqual({ count: 2 });
  });

  it('21. repeated transcript synchronization does not create duplicate records', async () => {
    const serviceToken = signJwt({ sub: config.serviceClientId, role: 'service', scope: 'transcript-sync' }, '5m');
    const response = await request('http://localhost:3002')
      .post('/transcript/sync')
      .set('X-Gateway-Secret', config.gatewaySecret)
      .set('Authorization', `Bearer ${serviceToken}`)
      .send({ classId: 1, studentIds: [4] });

    expect(response.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as c FROM transcripts WHERE class_id = 1').get().c).toBe(2);
  });

  it('22. logout revokes the refresh token', async () => {
    const login = await request(app)
      .post('/auth/login')
      .set('X-Device-ID', 'device-mhs-01')
      .send({ username: 'mahasiswa01', password: 'mahasiswa123' });

    const response = await request(app)
      .post('/auth/logout')
      .send({ refreshToken: login.body.refreshToken });

    expect(response.status).toBe(200);
  });

  it('23. revoked refresh token cannot be reused', async () => {
    const login = await request(app)
      .post('/auth/login')
      .set('X-Device-ID', 'device-mhs-01')
      .send({ username: 'mahasiswa01', password: 'mahasiswa123' });

    await request(app).post('/auth/logout').send({ refreshToken: login.body.refreshToken });
    const response = await request(app).post('/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(response.status).toBe(401);
  });

  it('24. audit logs contain both allowed and denied decisions without secrets', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('X-Device-ID', 'device-mhs-01')
      .send({ username: 'mahasiswa01', password: 'wrong' });

    expect(response.status).toBe(401);
    const logs = db.prepare("SELECT * FROM audit_logs WHERE endpoint = '/auth/login'").all();
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs).includes('mahasiswa123')).toBe(false);
  });

  it('25. invalid request cannot inject SQL or modify unauthorized records', async () => {
    const token = signJwt({ sub: '2', role: 'dosen' });
    const response = await request(app)
      .put('/nilai/1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-dosen-01')
      .send({ score: "1 OR 1=1" });

    expect(response.status).toBe(400);
  });

  it('26. gateway forwards authorized grade reads with the user token and gateway secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const token = signJwt({ sub: '4', role: 'mahasiswa' });

    const response = await request(app)
      .get('/nilai')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-mhs-01');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/grades', config.serviceNilaiUrl).toString(),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
          'X-Gateway-Secret': config.gatewaySecret,
          'X-Device-ID': 'device-mhs-01',
        }),
      }),
    );
  });

  it('27. gateway forwards authorized transcript reads to the transcript service', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 1 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const token = signJwt({ sub: '4', role: 'mahasiswa' });

    const response = await request(app)
      .get('/transkrip')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-ID', 'device-mhs-01');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/transcripts', config.serviceTranskripUrl).toString(),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
          'X-Gateway-Secret': config.gatewaySecret,
        }),
      }),
    );
  });

  it('28. only a service token can invoke transcript synchronization through the gateway', async () => {
    const token = signJwt({ sub: '4', role: 'mahasiswa' });
    const response = await request(app)
      .post('/transkrip/sinkron')
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 1, studentIds: [4] });

    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('INVALID_SERVICE_TOKEN');
  });

  it('29. a service token from another client cannot synchronize transcripts through the gateway', async () => {
    const token = signJwt({ sub: 'other-service', role: 'service', scope: 'transcript-sync' }, '5m');
    const response = await request(app)
      .post('/transkrip/sinkron')
      .set('Authorization', `Bearer ${token}`)
      .send({ classId: 1, studentIds: [4] });

    expect(response.status).toBe(401);
    expect(response.body.reason).toBe('INVALID_SERVICE_TOKEN');
  });
});
