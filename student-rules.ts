import { findGrade, type GradeId } from "@/data/curriculum";

export const GOVERNORATES = [
  "القاهرة",
  "الجيزة",
  "الإسكندرية",
  "الدقهلية",
  "الشرقية",
  "القليوبية",
  "كفر الشيخ",
  "الغربية",
  "المنوفية",
  "البحيرة",
  "دمياط",
  "بورسعيد",
  "الإسماعيلية",
  "السويس",
  "شمال سيناء",
  "جنوب سيناء",
  "الفيوم",
  "بني سويف",
  "المنيا",
  "أسيوط",
  "سوهاج",
  "قنا",
  "الأقصر",
  "أسوان",
  "البحر الأحمر",
  "الوادي الجديد",
  "مطروح",
] as const;

export type ProfileInput = {
  fullName: string;
  gradeId: GradeId;
  governorate: string;
  phone: string;
  parentPhone: string;
  email: string;
  nationalId: string;
};

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function validEgyptianMobile(value: string): boolean {
  return /^01[0125]\d{8}$/.test(value);
}

export function validNationalId(value: string): boolean {
  if (!/^\d{14}$/.test(value)) return false;
  if (value[0] !== "2" && value[0] !== "3") return false;
  const year = (value[0] === "2" ? 1900 : 2000) + Number(value.slice(1, 3));
  const month = Number(value.slice(3, 5));
  const day = Number(value.slice(5, 7));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function parseProfile(input: unknown): { ok: true; value: ProfileInput } | { ok: false; message: string } {
  if (!input || typeof input !== "object") return { ok: false, message: "بيانات الاشتراك ناقصة." };
  const raw = input as Record<string, unknown>;
  const fullName = String(raw.fullName ?? "").trim().replace(/\s+/g, " ");
  const gradeId = String(raw.gradeId ?? "");
  const governorate = String(raw.governorate ?? "").trim();
  const phone = digitsOnly(String(raw.phone ?? ""));
  const parentPhone = digitsOnly(String(raw.parentPhone ?? ""));
  const email = String(raw.email ?? "").trim().toLowerCase();
  const nationalId = digitsOnly(String(raw.nationalId ?? ""));

  if (fullName.length < 6 || fullName.split(" ").length < 2) {
    return { ok: false, message: "اكتب الاسم ثلاثياً كما في الأوراق." };
  }
  if (!findGrade(gradeId)) return { ok: false, message: "اختر الصف من أولى إعدادي إلى ثالثة ثانوي." };
  if (!GOVERNORATES.includes(governorate as (typeof GOVERNORATES)[number])) {
    return { ok: false, message: "اختر المحافظة من القائمة." };
  }
  if (!validEgyptianMobile(phone)) return { ok: false, message: "رقم الطالب لازم يكون موبايل مصري من ١١ رقماً." };
  if (!validEgyptianMobile(parentPhone)) return { ok: false, message: "رقم ولي الأمر لازم يكون موبايل مصري من ١١ رقماً." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "البريد الإلكتروني غير مكتمل." };
  if (!validNationalId(nationalId)) {
    return { ok: false, message: "الرقم القومي ١٤ رقماً، ويبدأ بـ ٢ أو ٣ ثم تاريخ ميلاد صحيح." };
  }

  return {
    ok: true,
    value: {
      fullName,
      gradeId: gradeId as GradeId,
      governorate,
      phone,
      parentPhone,
      email,
      nationalId,
    },
  };
}

export function maskNationalId(value: string): string {
  if (value.length < 4) return value;
  return `${"•".repeat(value.length - 4)}${value.slice(-4)}`;
}

export function gradeBand(percent: number): string {
  if (percent >= 90) return "امتياز";
  if (percent >= 80) return "جيد جداً";
  if (percent >= 65) return "جيد";
  if (percent >= 50) return "مقبول";
  return "يحتاج مراجعة";
}
