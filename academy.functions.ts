import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { findUnit } from "@/data/curriculum";
import { getSql } from "@/lib/db";
import { gradeBand, parseProfile, type ProfileInput } from "@/lib/student-rules";

export type StudentProfile = ProfileInput;

export type SmsMessage = {
  id: number;
  recipientRole: "student" | "parent";
  phone: string;
  body: string;
  examId: string | null;
  status: string;
  createdAt: string;
};

export type AttemptSummary = {
  id: number;
  examId: string;
  score: number;
  total: number;
  createdAt: string;
};

type ProfileRow = {
  full_name: string;
  grade_id: string;
  governorate: string;
  phone: string;
  parent_phone: string;
  email: string;
  national_id: string;
};

function mapProfile(row: ProfileRow): StudentProfile {
  return {
    fullName: row.full_name,
    gradeId: row.grade_id as StudentProfile["gradeId"],
    governorate: row.governorate,
    phone: row.phone,
    parentPhone: row.parent_phone,
    email: row.email,
    nationalId: row.national_id,
  };
}

async function deliver(phone: string, body: string): Promise<string> {
  const url = process.env.SMS_GATEWAY_URL;
  if (!url) return "recorded";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: phone, text: body }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? "sent" : "recorded";
  } catch {
    return "recorded";
  }
}

export const getProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<ProfileRow>`
      select full_name, grade_id, governorate, phone, parent_phone, email, national_id
      from student_profiles
      where user_id = ${context.userId}
      limit 1
    `;
    return rows[0] ? mapProfile(rows[0]) : null;
  });

export const getDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const profiles = await sql<ProfileRow>`
      select full_name, grade_id, governorate, phone, parent_phone, email, national_id
      from student_profiles
      where user_id = ${context.userId}
      limit 1
    `;
    const attempts = await sql<{ id: number; exam_id: string; score: number; total: number; created_at: string }>`
      select id, exam_id, score, total, created_at::text as created_at
      from exam_attempts
      where user_id = ${context.userId}
      order by id desc
      limit 30
    `;
    const messages = await sql<{
      id: number;
      recipient_role: "student" | "parent";
      phone: string;
      body: string;
      exam_id: string | null;
      status: string;
      created_at: string;
    }>`
      select id, recipient_role, phone, body, exam_id, status, created_at::text as created_at
      from sms_messages
      where user_id = ${context.userId}
      order by id desc
      limit 40
    `;
    return {
      profile: profiles[0] ? mapProfile(profiles[0]) : null,
      attempts: attempts.map((row) => ({
        id: row.id,
        examId: row.exam_id,
        score: row.score,
        total: row.total,
        createdAt: row.created_at,
      })),
      messages: messages.map((row) => ({
        id: row.id,
        recipientRole: row.recipient_role,
        phone: row.phone,
        body: row.body,
        examId: row.exam_id,
        status: row.status,
        createdAt: row.created_at,
      })),
    };
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    const parsed = parseProfile(data);
    if (!parsed.ok) return parsed;
    const profile = parsed.value;
    const sql = await getSql();
    const clash = await sql<{ user_id: string }>`
      select user_id from student_profiles
      where national_id = ${profile.nationalId} and user_id <> ${context.userId}
      limit 1
    `;
    if (clash.length > 0) {
      return { ok: false as const, message: "هذا الرقم القومي مسجّل على حساب آخر." };
    }
    await sql`
      insert into student_profiles (
        user_id, full_name, grade_id, governorate, phone, parent_phone, email, national_id
      ) values (
        ${context.userId},
        ${profile.fullName},
        ${profile.gradeId},
        ${profile.governorate},
        ${profile.phone},
        ${profile.parentPhone},
        ${profile.email},
        ${profile.nationalId}
      )
      on conflict (user_id) do update set
        full_name = excluded.full_name,
        grade_id = excluded.grade_id,
        governorate = excluded.governorate,
        phone = excluded.phone,
        parent_phone = excluded.parent_phone,
        email = excluded.email,
        national_id = excluded.national_id,
        updated_at = now()
    `;
    return { ok: true as const };
  });

type SubmitInput = { examId: string; answers: Record<string, string> };

export const getExamPaper = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const examId = typeof input === "object" && input && "examId" in input ? String((input as { examId: unknown }).examId) : "";
    return { examId };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const profiles = await sql<{ user_id: string }>`
      select user_id from student_profiles where user_id = ${context.userId} limit 1
    `;
    if (!profiles[0]) return { ok: false as const, message: "أكمل الاشتراك قبل أن تبدأ الامتحان." };
    const { buildPaper } = await import("@/data/exam-bank.server");
    const paper = buildPaper(data.examId);
    if (!paper) return { ok: false as const, message: "هذا الامتحان غير موجود." };
    return { ok: true as const, paper };
  });

export const submitExam = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): SubmitInput => {
    if (!input || typeof input !== "object") return { examId: "", answers: {} };
    const raw = input as { examId?: unknown; answers?: unknown };
    const answers: Record<string, string> = {};
    if (raw.answers && typeof raw.answers === "object") {
      for (const [key, value] of Object.entries(raw.answers as Record<string, unknown>)) {
        if (typeof value === "string" && value.length < 400) answers[key] = value;
      }
    }
    return { examId: String(raw.examId ?? ""), answers };
  })
  .handler(async ({ context, data }) => {
    const unit = findUnit(data.examId);
    if (!unit) return { ok: false as const, message: "هذا الامتحان غير موجود." };
    const { gradeAnswers } = await import("@/data/exam-bank.server");
    const graded = gradeAnswers(data.examId, data.answers);
    if (!graded) return { ok: false as const, message: "تعذر تصحيح الامتحان." };

    const sql = await getSql();
    const profiles = await sql<ProfileRow>`
      select full_name, grade_id, governorate, phone, parent_phone, email, national_id
      from student_profiles where user_id = ${context.userId} limit 1
    `;
    const profileRow = profiles[0];
    if (!profileRow) return { ok: false as const, message: "أكمل الاشتراك قبل تسليم الامتحان." };
    const profile = mapProfile(profileRow);
    const percent = Math.round((graded.score / graded.total) * 100);
    const band = gradeBand(percent);
    const inserted = await sql<{ id: number }>`
      insert into exam_attempts (user_id, exam_id, score, total, answers_json)
      values (${context.userId}, ${data.examId}, ${graded.score}, ${graded.total}, ${JSON.stringify(data.answers)})
      returning id
    `;
    const attemptId = inserted[0]?.id ?? 0;
    const studentBody = [
      "SCI | أكاديمية الكيمياء",
      `الطالب: ${profile.fullName}`,
      `الامتحان: ${unit.exam.title}`,
      `الدرجة: ${graded.score} من ${graded.total} (${percent}%)`,
      `التقدير: ${band}`,
      "راجع تفسير الإجابات داخل المنصة. الفهم أبعد من الدرجة.",
    ].join("\n");
    const gradeTitle = (await import("@/data/curriculum")).findGrade(profile.gradeId)?.title ?? profile.gradeId;
    const parentText = [
      "SCI | أكاديمية الكيمياء",
      `نتيجة: ${profile.fullName}`,
      `الصف: ${gradeTitle}`,
      `الامتحان: ${unit.exam.title}`,
      `الدرجة: ${graded.score} من ${graded.total} (${percent}%)`,
      `التقدير: ${band}`,
    ].join("\n");

    const targets =
      profile.phone === profile.parentPhone
        ? [{ role: "student" as const, phone: profile.phone, body: `${studentBody}\n(الرقم نفسه مسجّل لولي الأمر)` }]
        : [
            { role: "student" as const, phone: profile.phone, body: studentBody },
            { role: "parent" as const, phone: profile.parentPhone, body: parentText },
          ];

    const messages: SmsMessage[] = [];
    for (const target of targets) {
      const status = await deliver(target.phone, target.body);
      const rows = await sql<{ id: number; created_at: string }>`
        insert into sms_messages (user_id, recipient_role, phone, body, exam_id, status)
        values (${context.userId}, ${target.role}, ${target.phone}, ${target.body}, ${data.examId}, ${status})
        returning id, created_at::text as created_at
      `;
      const row = rows[0];
      if (!row) continue;
      messages.push({
        id: row.id,
        recipientRole: target.role,
        phone: target.phone,
        body: target.body,
        examId: data.examId,
        status,
        createdAt: row.created_at,
      });
    }

    return {
      ok: true as const,
      attemptId,
      score: graded.score,
      total: graded.total,
      percent,
      gradeLabel: band,
      review: graded.review,
      messages,
    };
  });

export const reviewAttempt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const id = Number(typeof input === "object" && input && "id" in input ? (input as { id: unknown }).id : input);
    if (!Number.isInteger(id) || id <= 0) throw new Error("محاولة غير صالحة");
    return id;
  })
  .handler(async ({ context, data: attemptId }) => {
    const sql = await getSql();
    const rows = await sql<{ exam_id: string; score: number; total: number; answers_json: string }>`
      select exam_id, score, total, answers_json
      from exam_attempts
      where id = ${attemptId} and user_id = ${context.userId}
      limit 1
    `;
    const row = rows[0];
    if (!row) return { ok: false as const, message: "لا توجد هذه المحاولة في ملفك." };
    const answers = JSON.parse(row.answers_json) as Record<string, string>;
    const { gradeAnswers } = await import("@/data/exam-bank.server");
    const graded = gradeAnswers(row.exam_id, answers);
    if (!graded) return { ok: false as const, message: "تعذر فتح المراجعة." };
    const percent = Math.round((row.score / row.total) * 100);
    return {
      ok: true as const,
      examId: row.exam_id,
      score: row.score,
      total: row.total,
      percent,
      gradeLabel: gradeBand(percent),
      review: graded.review,
    };
  });
