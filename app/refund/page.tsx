import type { Metadata } from "next";
import LegalLayout from "@/app/components/LegalLayout";
import { BRAND_NAME, SUPPORT_EMAIL } from "@/app/lib/legal";

export const metadata: Metadata = {
  title: "Refund Policy — Norveko",
};

export default function RefundPage() {
  return (
    <LegalLayout title="Refund Policy">
      <section>
        <h2>1. Overview</h2>
        <p>
          {BRAND_NAME} operates on a prepaid credit system. Credit packages are
          one-time purchases processed by our merchant of record, Paddle. This
          policy explains when purchases are eligible for a refund.
        </p>
      </section>

      <section>
        <h2>2. Refund Eligibility</h2>
        <ul>
          <li>
            <strong className="text-white">Unused credits:</strong> if you have
            not used any credits from a purchase, you may request a full refund
            within 14 days of the purchase date.
          </li>
          <li>
            <strong className="text-white">Used credits:</strong> once you
            begin using credits from a purchase, that purchase is no longer
            eligible for a refund.
          </li>
          <li>
            <strong className="text-white">Failed generations:</strong> if an
            AI generation fails due to a technical error on our side, the
            credits spent on that generation are automatically returned to your
            balance. This happens instantly and does not require a refund
            request.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. How to Request a Refund</h2>
        <p>
          Email us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-300 underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          from the email address associated with your account, and include your
          purchase date and the package you bought. Eligible refunds are
          processed through Paddle back to your original payment method,
          typically within 5–10 business days depending on your bank.
        </p>
      </section>

      <section>
        <h2>4. Exceptional Cases</h2>
        <p>
          Nothing in this policy limits any rights you may have under
          applicable consumer protection law. If you believe your situation
          warrants an exception (for example, duplicate purchases or billing
          errors), contact us and we will review it in good faith.
        </p>
      </section>
    </LegalLayout>
  );
}