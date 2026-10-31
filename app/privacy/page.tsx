import type { Metadata } from "next";
import LegalLayout from "@/app/components/LegalLayout";
import {
  BRAND_NAME,
  LEGAL_NAME,
  SUPPORT_EMAIL,
  WEBSITE_URL,
} from "@/app/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — Norveko",
};

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <section>
        <h2>1. Introduction</h2>
        <p>
          This Privacy Policy explains how {LEGAL_NAME} (&quot;we&quot;,
          &quot;us&quot;) collects, uses, and protects your personal data when
          you use {BRAND_NAME} at {WEBSITE_URL}{" "}(the &quot;Service&quot;).
        </p>
      </section>

      <section>
        <h2>2. Data We Collect</h2>
        <ul>
          <li>
            <strong className="text-white">Account data:</strong> your email
            address and authentication information when you sign up (including
            via Google sign-in).
          </li>
          <li>
            <strong className="text-white">Usage data:</strong> the prompts you
            submit, the content you generate, your projects, and your credit
            balance and transaction history.
          </li>
          <li>
            <strong className="text-white">Payment data:</strong> payments are
            processed by Paddle, our merchant of record. We do not store your
            card details; we receive transaction confirmations and purchase
            records from Paddle.
          </li>
          <li>
            <strong className="text-white">Technical data:</strong> standard
            log information such as IP address, browser type, and device
            information, used for security and to operate the Service.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. How We Use Your Data</h2>
        <ul>
          <li>to provide, maintain, and improve the Service;</li>
          <li>to process your AI generation requests;</li>
          <li>to manage your credit balance and purchases;</li>
          <li>to communicate with you about your account and the Service;</li>
          <li>to prevent fraud and abuse and to comply with legal obligations.</li>
        </ul>
        <p>We do not sell your personal data.</p>
      </section>

      <section>
        <h2>4. Third-Party Processors</h2>
        <p>
          We rely on trusted third-party providers to operate the Service. Your
          data may be processed by:
        </p>
        <ul>
          <li>
            <strong className="text-white">Supabase</strong> — database,
            authentication, and file storage;
          </li>
          <li>
            <strong className="text-white">Vercel</strong> — application
            hosting;
          </li>
          <li>
            <strong className="text-white">Google (Gemini API)</strong> and{" "}
            <strong className="text-white">OpenAI</strong> — processing of your
            prompts to generate content;
          </li>
          <li>
            <strong className="text-white">Paddle</strong> — payment processing
            as merchant of record.
          </li>
        </ul>
        <p>
          These providers process data on our behalf under their own privacy
          and security commitments. Prompts sent to AI providers are used to
          generate your requested content.
        </p>
      </section>

      <section>
        <h2>4.1 YouTube API Services</h2>
        <p>
          If you choose to connect a YouTube channel, Norveko uses YouTube API
          Services to upload the videos you publish and to read your channel&apos;s
          name and picture. By connecting, you agree to the{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            YouTube Terms of Service
          </a>
          , and Google&apos;s handling of your data is described in the{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          .
        </p>
        <ul>
          <li>
            We request only the permissions to upload videos and to read basic
            channel information. We cannot delete or edit your existing videos.
          </li>
          <li>
            We store an encrypted access grant, your channel ID, name and
            picture, and the IDs of videos you uploaded through Norveko. We use
            this data only to publish videos you ask us to publish.
          </li>
          <li>
            Norveko&apos;s use and transfer of information received from Google
            APIs adheres to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. We do not sell this data,
            use it for advertising, or use it to train AI models.
          </li>
          <li>
            You can disconnect at any time in Settings (this deletes the stored
            grant) or revoke access on the{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
            >
              Google security settings page
            </a>
            . Deleting your Norveko account also deletes this data.
          </li>
        </ul>
      </section>

      <section>
        <h2>4.2 TikTok</h2>
        <p>
          If you connect a TikTok account, Norveko uses TikTok&apos;s Login Kit and
          Content Posting API to read your basic profile (display name and
          picture) and to post the videos you choose to publish. We store an
          encrypted access grant and your profile name and picture, and use them
          only to post videos you ask us to post. You can disconnect at any time
          in Settings or in your TikTok app&apos;s security settings; deleting your
          Norveko account also deletes this data.
        </p>
      </section>

      <section>
        <h2>5. Cookies</h2>
        <p>
          We use essential cookies to keep you signed in and to operate core
          functionality of the Service. We do not use third-party advertising
          cookies.
        </p>
      </section>

      <section>
        <h2>6. Data Retention</h2>
        <p>
          We retain your data for as long as your account is active. If you
          delete your account, we delete or anonymize your personal data within
          a reasonable period, except where retention is required by law (for
          example, purchase records for tax purposes).
        </p>
      </section>

      <section>
        <h2>7. Your Rights</h2>
        <p>
          Depending on your location, you may have the right to access,
          correct, export, or delete your personal data, restrict or object to
          its processing, and lodge a complaint with a supervisory authority.
          To exercise these rights, contact us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-300 underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>

      <section>
        <h2>8. Security</h2>
        <p>
          We take reasonable technical and organizational measures to protect
          your data, including encrypted connections (HTTPS), access controls,
          and row-level security on our database. No method of transmission or
          storage is completely secure, but we work to protect your information
          appropriately.
        </p>
      </section>

      <section>
        <h2>9. Children</h2>
        <p>
          The Service is not directed at children under 18, and we do not
          knowingly collect personal data from them.
        </p>
      </section>

      <section>
        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Material changes
          will be communicated by email or through the Service.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          For privacy-related questions, contact us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-blue-300 underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </LegalLayout>
  );
}