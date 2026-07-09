import type { Metadata } from "next";
import LegalLayout from "@/app/components/LegalLayout";
import {
  BRAND_NAME,
  LEGAL_NAME,
  SUPPORT_EMAIL,
  WEBSITE_URL,
} from "@/app/lib/legal";

export const metadata: Metadata = {
  title: "Terms & Conditions — Norveko",
};

export default function TermsPage() {
  return (
    <LegalLayout title="Terms & Conditions">
      <section>
        <h2>1. Introduction</h2>
        <p>
          These Terms &amp; Conditions (&quot;Terms&quot;) govern your use of{" "}
          {BRAND_NAME}, an AI-powered video content creation platform available
          at {WEBSITE_URL} (the &quot;Service&quot;). The Service is operated by{" "}
          {LEGAL_NAME}{" "}(&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;). By
          creating an account or using the Service, you agree to be bound by
          these Terms. If you do not agree, please do not use the Service.
        </p>
      </section>

      <section>
        <h2>2. The Service</h2>
        <p>
          {BRAND_NAME} provides AI-assisted tools that help content creators
          generate scripts, scene plans, video prompts, titles, descriptions,
          tags, thumbnails, and related materials for video platforms such as
          YouTube, TikTok, and Instagram. Features may be added, modified, or
          removed at any time as the Service evolves.
        </p>
      </section>

      <section>
        <h2>3. Accounts</h2>
        <p>
          You must create an account to use the Service. You are responsible
          for maintaining the confidentiality of your account credentials and
          for all activity that occurs under your account. You must provide
          accurate information and be at least 18 years old, or the age of
          legal majority in your jurisdiction, to use the Service.
        </p>
      </section>

      <section>
        <h2>4. Credits and Payments</h2>
        <p>
          The Service operates on a prepaid credit system. Credits are consumed
          when you use AI generation features. Credit packages are one-time
          purchases, not subscriptions.
        </p>
        <p>
          Payments are processed by our merchant of record, Paddle.com Market
          Ltd (&quot;Paddle&quot;). Paddle handles payment processing, invoicing,
          and applicable taxes. By making a purchase, you also agree to
          Paddle&apos;s Buyer Terms.
        </p>
        <ul>
          <li>Credits have no cash value and cannot be transferred or resold.</li>
          <li>
            Credits do not expire while your account remains active, unless
            otherwise stated at the time of purchase.
          </li>
          <li>
            If an AI generation fails due to a technical error on our side, the
            credits used for that generation are automatically refunded to your
            balance.
          </li>
          <li>
            Refunds of purchases are governed by our{" "}
            <a href="/refund" className="text-blue-300 underline">
              Refund Policy
            </a>
            .
          </li>
        </ul>
      </section>

      <section>
        <h2>5. Acceptable Use</h2>
        <p>You agree not to use the Service to:</p>
        <ul>
          <li>violate any applicable law or regulation;</li>
          <li>
            generate content that is illegal, defamatory, harassing, hateful,
            or that infringes the rights of others;
          </li>
          <li>
            attempt to reverse engineer, disrupt, or gain unauthorized access
            to the Service or its infrastructure;
          </li>
          <li>
            resell or provide automated access to the Service without our prior
            written consent.
          </li>
        </ul>
        <p>
          We may suspend or terminate accounts that violate these Terms.
        </p>
      </section>

      <section>
        <h2>6. AI-Generated Content</h2>
        <p>
          Subject to these Terms and applicable third-party terms, you own the
          content you generate through the Service and may use it for personal
          or commercial purposes. AI-generated output may be inaccurate,
          incomplete, or similar to output generated for other users. You are
          responsible for reviewing generated content before publishing it and
          for ensuring your use complies with the policies of the platforms
          where you publish.
        </p>
      </section>

      <section>
        <h2>7. Intellectual Property</h2>
        <p>
          The Service, including its software, design, branding, and content
          (excluding your generated content), is owned by {LEGAL_NAME} and is
          protected by intellectual property laws. We grant you a limited,
          non-exclusive, non-transferable license to use the Service in
          accordance with these Terms.
        </p>
      </section>

      <section>
        <h2>8. Disclaimers</h2>
        <p>
          The Service is provided &quot;as is&quot; and &quot;as
          available&quot; without warranties of any kind, express or implied.
          We do not guarantee that the Service will be uninterrupted,
          error-free, or that generated content will meet your expectations or
          achieve any particular results.
        </p>
      </section>

      <section>
        <h2>9. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, {LEGAL_NAME} shall not be
          liable for any indirect, incidental, special, consequential, or
          punitive damages, or any loss of profits, revenue, or data, arising
          from your use of the Service. Our total liability for any claim
          arising out of these Terms shall not exceed the amount you paid to us
          in the twelve (12) months preceding the claim.
        </p>
      </section>

      <section>
        <h2>10. Termination</h2>
        <p>
          You may stop using the Service and delete your account at any time.
          We may suspend or terminate your access if you breach these Terms.
          Upon termination, your right to use the Service ceases immediately;
          unused credits are handled in accordance with our Refund Policy and
          applicable law.
        </p>
      </section>

      <section>
        <h2>11. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. If we make material
          changes, we will notify you by email or through the Service. Your
          continued use of the Service after changes take effect constitutes
          acceptance of the updated Terms.
        </p>
      </section>

      <section>
        <h2>12. Contact</h2>
        <p>
          If you have questions about these Terms, contact us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-300 underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </LegalLayout>
  );
}