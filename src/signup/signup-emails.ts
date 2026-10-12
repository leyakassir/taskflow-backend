/** Email texts for account requests, in English and Arabic. */
export type SignupLang = 'en' | 'ar';

export const SIGNUP_CODE_TTL_MINUTES = 10;

const TEXT = {
  en: {
    codeSubject: 'Confirm your TaskFlow account request',
    codeIntro: 'Enter this code in the TaskFlow app to send your account request to an administrator:',
    codeExpiry: `It expires in ${SIGNUP_CODE_TTL_MINUTES} minutes.`,
    ignore: "If you didn't ask for a TaskFlow account, ignore this email.",
    existsSubject: 'You already have a TaskFlow account',
    exists: 'Someone asked for a TaskFlow account with this email, but you already have one. Sign in, or use "Forgot password?" in the app.',
    pendingSubject: 'Your TaskFlow account request is waiting',
    pending: 'Your account request is already with an administrator. You will get an email when it is approved.',
    approvedSubject: 'Your TaskFlow account is ready',
    approved: 'An administrator approved your request. Sign in to the TaskFlow app with this email and the password you chose.',
    rejectedSubject: 'Your TaskFlow account request',
    rejected: 'An administrator did not approve your account request.',
    reason: 'Reason:',
  },
  ar: {
    codeSubject: 'تأكيد طلب حساب TaskFlow',
    codeIntro: 'أدخل هذا الرمز في تطبيق TaskFlow لإرسال طلب حسابك إلى المسؤول:',
    codeExpiry: `تنتهي صلاحيته خلال ${SIGNUP_CODE_TTL_MINUTES} دقائق.`,
    ignore: 'إذا لم تطلب حسابًا في TaskFlow فتجاهل هذه الرسالة.',
    existsSubject: 'لديك حساب TaskFlow بالفعل',
    exists: 'طلب أحدهم حساب TaskFlow بهذا البريد، لكن لديك حسابًا بالفعل. سجّل الدخول، أو استخدم "هل نسيت كلمة المرور؟" في التطبيق.',
    pendingSubject: 'طلب حساب TaskFlow قيد المراجعة',
    pending: 'طلب حسابك لدى المسؤول بالفعل. ستصلك رسالة عند الموافقة عليه.',
    approvedSubject: 'حساب TaskFlow جاهز',
    approved: 'وافق المسؤول على طلبك. سجّل الدخول في تطبيق TaskFlow بهذا البريد وكلمة المرور التي اخترتها.',
    rejectedSubject: 'طلب حساب TaskFlow',
    rejected: 'لم يوافق المسؤول على طلب حسابك.',
    reason: 'السبب:',
  },
} as const;

function html(lang: SignupLang, body: string) {
  return `<div dir="${lang === 'ar' ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;font-size:15px;color:#0F1117;line-height:1.5">${body}</div>`;
}

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function codeEmail(lang: SignupLang, code: string) {
  const t = TEXT[lang];
  return {
    subject: t.codeSubject,
    text: `${t.codeIntro}\n\n${code}\n\n${t.codeExpiry}\n\n${t.ignore}`,
    html: html(
      lang,
      `<p>${t.codeIntro}</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#5B6AF0;margin:20px 0" dir="ltr">${code}</p><p>${t.codeExpiry}</p><p style="color:#666B87;font-size:13px">${t.ignore}</p>`,
    ),
  };
}

export function noticeEmail(
  lang: SignupLang,
  kind: 'exists' | 'pending' | 'approved' | 'rejected',
  reason?: string | null,
) {
  const t = TEXT[lang];
  const subject = t[`${kind}Subject`];
  const body: string = t[kind];
  const reasonLine = kind === 'rejected' && reason ? `${t.reason} ${reason}` : '';
  return {
    subject,
    text: reasonLine ? `${body}\n\n${reasonLine}` : body,
    html: html(lang, `<p>${body}</p>${reasonLine ? `<p>${escape(reasonLine)}</p>` : ''}`),
  };
}
