import bcrypt from 'bcryptjs';
import { db, migrate } from './db';
import { addDays, lastMonths, pad, toISO, todayISO } from './utils/dates';

/** small deterministic PRNG so the demo data is always the same */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function recentWeekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(toISO(d));
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

export function resetDatabase() {
  db.exec(`DELETE FROM match_results; DELETE FROM match_students; DELETE FROM match_staff; DELETE FROM matches;
           DELETE FROM assessments; DELETE FROM attendance; DELETE FROM activity;
           DELETE FROM students; DELETE FROM staff; DELETE FROM users;`);
}

export function seedIfEmpty() {
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    seedDatabase();
    console.log('Database was empty → demo data created. Logins: admin/admin123, vikram/staff123, arjun/student123');
  }
}

export function seedDatabase() {
  const R = rng(42);
  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const today = todayISO();

  const students = [
    { id: 'STU001', u: 'arjun', name: 'Arjun Mehta', dob: '12/03/2012', level: 'Advanced', batch: 'Batch A', phone: '+91 98765 43210', parent: 'Rajesh Mehta', pp: '+91 98765 43211', email: 'arjun@mail.com', gender: 'Male', joined: 'Jan 2024', address: '12 Park St, Mumbai', att: 92, perf: 87 },
    { id: 'STU002', u: 'priya', name: 'Priya Sharma', dob: '05/08/2014', level: 'Intermediate', batch: 'Batch B', phone: '+91 87654 32109', parent: 'Sunita Sharma', pp: '+91 87654 32108', email: 'priya@mail.com', gender: 'Female', joined: 'Mar 2024', address: '45 Lake Rd, Delhi', att: 85, perf: 78 },
    { id: 'STU003', u: 'rohan', name: 'Rohan Das', dob: '21/01/2011', level: 'Beginner', batch: 'Batch A', phone: '+91 76543 21098', parent: 'Amit Das', pp: '+91 76543 21097', email: 'rohan@mail.com', gender: 'Male', joined: 'Feb 2024', address: '7 Hill View, Pune', att: 70, perf: 62 },
    { id: 'STU004', u: 'anika', name: 'Anika Patel', dob: '30/11/2012', level: 'Advanced', batch: 'Batch C', phone: '+91 65432 10987', parent: 'Nira Patel', pp: '+91 65432 10986', email: 'anika@mail.com', gender: 'Female', joined: 'Jan 2024', address: '3 Rose Ave, Bangalore', att: 96, perf: 94 },
    { id: 'STU005', u: 'kiran', name: 'Kiran Nair', dob: '17/06/2015', level: 'Beginner', batch: 'Batch B', phone: '+91 54321 09876', parent: 'Latha Nair', pp: '+91 54321 09875', email: 'kiran@mail.com', gender: 'Male', joined: 'Apr 2024', address: '9 Sea View, Kochi', att: 88, perf: 71 },
  ];
  const staff = [
    { id: 'STF001', u: 'vikram', name: 'Vikram Singh', email: 'vikram@academy.com', phone: '+91 99887 76655', batch: 'Batch A', joined: 'Jun 2023', address: '15 Green Park, Mumbai' },
    { id: 'STF002', u: 'deepa', name: 'Deepa Rao', email: 'deepa@academy.com', phone: '+91 88776 65544', batch: 'Batch B, C', joined: 'Aug 2023', address: '22 MG Road, Bangalore' },
    { id: 'STF003', u: 'suresh', name: 'Suresh Kumar', email: 'suresh@academy.com', phone: '+91 77665 54433', batch: 'Batch C', joined: 'Oct 2023', address: '5 Civil Lines, Delhi' },
  ];
  const comments: Record<string, string> = {
    STU001: 'Shows excellent tactical awareness. Needs to work on endgame techniques. Very disciplined in tournament play.',
    STU002: 'Steady improvement in openings. Should practise calculating longer variations.',
    STU003: 'Great enthusiasm. Focus on basic checkmates and piece safety.',
    STU004: 'Outstanding results. Ready for stronger opposition at regional level.',
    STU005: 'Learning fast. Work on time management during games.',
  };

  db.transaction(() => {
    resetDatabase();

    db.prepare('INSERT INTO users (ref_id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?)').run('ADM001', 'admin', hash('admin123'), 'admin', 'Admin');

    for (const t of staff) {
      db.prepare('INSERT INTO staff (id, name, email, phone, batch, status, joined, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(t.id, t.name, t.email, t.phone, t.batch, 'Active', t.joined, t.address);
      db.prepare('INSERT INTO users (ref_id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?)').run(t.id, t.u, hash('staff123'), 'staff', t.name);
    }

    const days = recentWeekdays(250);
    const months = lastMonths(12);
    for (const s of students) {
      db.prepare(`INSERT INTO students (id, name, dob, age, level, batch, phone, parent, parent_phone, email, gender, joined, address, status)
        VALUES (?, ?, ?, 12, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`)
        .run(s.id, s.name, s.dob, s.level, s.batch, s.phone, s.parent, s.pp, s.email, s.gender, s.joined, s.address);
      db.prepare('INSERT INTO users (ref_id, username, password_hash, role, name) VALUES (?, ?, ?, ?, ?)').run(s.id, s.u, hash('student123'), 'student', s.name);

      // attendance: exactly `att`% present over the last ~12 months of weekdays, absences spread randomly
      const absent = new Set([...days.keys()].sort(() => R() - 0.5).slice(0, days.length - Math.round((s.att / 100) * days.length)));
      days.forEach((d, i) => db.prepare('INSERT INTO attendance (student_id, date, present, marked_by) VALUES (?, ?, ?, ?)').run(s.id, d, absent.has(i) ? 0 : 1, 'STF001'));

      // one assessment per month, climbing to the target score
      const base = Math.max(40, s.perf - 25);
      months.forEach((m, i) => {
        const last = i === months.length - 1;
        const date = last || `${m}-15` > today ? today : `${m}-15`;
        const score = last ? s.perf : clamp(base + ((s.perf - base) * i) / 11 + (R() * 4 - 2));
        const sk = () => clamp(score + (R() * 12 - 6));
        db.prepare(`INSERT INTO assessments (student_id, date, score, tactics, openings, endgame, analysis, tournament, comments, coach_id, coach_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'STF001', 'Vikram Singh')`)
          .run(s.id, date, score, sk(), sk(), sk(), sk(), sk(), last ? comments[s.id] : null);
      });
    }

    const mt = db.prepare('INSERT INTO matches (id, name, type, venue, date, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const ms = db.prepare('INSERT INTO match_students (match_id, student_id) VALUES (?, ?)');
    const mf = db.prepare('INSERT INTO match_staff (match_id, staff_id) VALUES (?, ?)');
    const matches = [
      { id: 'MTH001', name: 'School Chess Championship', type: 'School Tournament', venue: "St. Joseph's School, Mumbai", d: 5, s: '09:00', e: '17:00', st: ['STU001', 'STU002', 'STU004'], sf: ['STF001'] },
      { id: 'MTH002', name: 'Academy Open Tournament', type: 'Academy Tournament', venue: 'Chess Academy Hall, Delhi', d: 10, s: '10:00', e: '16:00', st: ['STU001', 'STU003', 'STU005'], sf: ['STF002'] },
      { id: 'MTH003', name: 'Inter-School Chess Cup', type: 'Inter-School Tournament', venue: 'City Sports Complex, Jaffna', d: 15, s: '08:30', e: '18:00', st: ['STU001', 'STU002', 'STU003', 'STU004'], sf: ['STF001', 'STF002'] },
      { id: 'MTH004', name: 'Friendly Practice Match', type: 'Friendly Match', venue: 'Academy Training Room', d: -10, s: '15:00', e: '18:00', st: ['STU001', 'STU004', 'STU005'], sf: ['STF003'] },
    ];
    for (const m of matches) {
      mt.run(m.id, m.name, m.type, m.venue, addDays(today, m.d), m.s, m.e);
      m.st.forEach(id => ms.run(m.id, id));
      m.sf.forEach(id => mf.run(m.id, id));
    }
    const mr = db.prepare('INSERT INTO match_results (match_id, student_id, played, wins, draws, losses, points, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    mr.run('MTH004', 'STU001', 5, 3, 1, 1, '3.5/5', '2nd');
    mr.run('MTH004', 'STU004', 5, 4, 1, 0, '4.5/5', '1st');
    mr.run('MTH004', 'STU005', 5, 1, 0, 4, '1/5', '3rd');

    const act = db.prepare("INSERT INTO activity (text, type, created_at) VALUES (?, ?, datetime('now', ?))");
    act.run('Monthly report generated', 'default', '-2 days');
    act.run('New student Kiran Nair added', 'primary', '-1 days');
    act.run('Batch A attendance marked by Vikram Singh', 'default', '-3 hours');
    act.run('Arjun Mehta scored 87 in assessment', 'success', '-2 hours');
  })();
}

if (require.main === module) {
  migrate();
  seedDatabase();
  console.log('Seeded demo data. Logins: admin/admin123, vikram/staff123, deepa/staff123, arjun/student123, priya/student123');
}
