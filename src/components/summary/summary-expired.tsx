import Image from "next/image";
import { COMPANY_CONTACT } from "@/lib/constants/inspection";

export function SummaryExpired() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="mx-auto max-w-md text-center">
        <Image
          src="/sewertime-logo.png"
          alt="SewerTime Septic"
          width={180}
          height={60}
          className="mx-auto mb-6"
        />
        <h1 className="text-xl font-semibold text-stone-800">
          Summary No Longer Available
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          This inspection summary has expired or is no longer available. Please
          contact us if you need a copy of your inspection report.
        </p>
        <div className="mt-6 space-y-2 text-sm text-stone-600">
          <a
            href={`mailto:${COMPANY_CONTACT.email}`}
            className="block underline underline-offset-2 hover:text-stone-900"
          >
            {COMPANY_CONTACT.email}
          </a>
          <a
            href={`tel:+1${COMPANY_CONTACT.phone.replace(/\D/g, "")}`}
            className="block underline underline-offset-2 hover:text-stone-900"
          >
            {COMPANY_CONTACT.phone}
          </a>
        </div>
      </div>
    </div>
  );
}
