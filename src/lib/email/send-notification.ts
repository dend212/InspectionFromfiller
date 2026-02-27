import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/**
 * Send an email notification to the admin when a new inspection is submitted.
 *
 * Fire-and-forget: logs and returns silently on failure.
 * Gracefully degrades when RESEND_API_KEY or ADMIN_NOTIFICATION_EMAIL
 * are not configured (skips sending with a console log).
 */
export async function sendSubmissionNotification(
  inspectionId: string,
  facilityName: string | null,
  inspectorName: string | null
) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!resend || !adminEmail) {
    console.log(
      "Email notification skipped: RESEND_API_KEY or ADMIN_NOTIFICATION_EMAIL not configured"
    );
    return;
  }

  try {
    await resend.emails.send({
      from: "SewerTime Inspections <onboarding@resend.dev>",
      to: adminEmail,
      subject: `New Inspection Submitted: ${facilityName || "Untitled"}`,
      text: [
        "A new inspection has been submitted for review.",
        "",
        `Facility: ${facilityName || "Untitled"}`,
        inspectorName ? `Inspector: ${inspectorName}` : "",
        "",
        `Review it here: ${process.env.NEXT_PUBLIC_APP_URL || "https://sewertime.vercel.app"}/review/${inspectionId}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (err) {
    // Fire-and-forget: log but don't throw
    console.error("Failed to send submission notification:", err);
  }
}
