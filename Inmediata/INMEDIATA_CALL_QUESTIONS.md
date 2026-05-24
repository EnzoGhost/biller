# Inmediata Call — Questions to Ask

**Call purpose:** Connecting AngelClaims to Inmediata clearinghouse via SecureTrack EDI Web Services

---

## 🔐 Credentials & Access

1. **How do we get UAT/sandbox credentials?** The guide mentions QA endpoint (`securetrack-uat.inmediata.com`) — do we need to request a separate test account?
2. **What's the onboarding process?** Is there a testing/certification requirement before going live?
3. **Are credentials per-clinic or per-organization?** AngelClaims is multi-clinic — do we get one set of creds or one per clinic?

---

## 🏥 Payer Enrollment & Configuration

4. **Which payers are already enrolled/supported for PR?** We need a payer list with their IDs for Puerto Rico specifically.
5. **Do we need to enroll with each payer separately, or does Inmediata handle that?**
6. **What's the ISA sender ID (ETIN) we should use in our 837 files?**
7. **For `FixX12Envelope=false` (which we plan to use) — what exactly should we put in ISA06 (sender ID) and ISA08 (receiver ID)?**

---

## 📋 Claims Submission (837P)

8. **Any specific ISA/GS envelope requirements you have for PR submitters?**
9. **Do you have a sample 837P file we can test with?**
10. **What's the expected turnaround for claim acknowledgments (999/TA1)?**
11. **Do you return 277CA (claim acknowledgment) or just 999?**

---

## ✅ Eligibility (270/271)

12. **Which payers support real-time eligibility via `SendRealTime`?** Do you have a list?
13. **Is there a rate limit on real-time eligibility calls?** (e.g., max requests per minute/hour)
14. **What's typical response time for 271?**

---

## 📥 Response File Polling

15. **How often should we poll `GetRoutedFiles` / `ListRoutedFiles`?** Is there a recommended interval?
16. **Is there a webhook or push notification option** instead of polling? (The guide doesn't mention one)
17. **How long do files stay available for download** before they expire?

---

## ❌ Error Handling

18. **Can you share a full list of error codes and messages** returned in the `Message` field? The guide only says "error message" — we need to know what to expect.
19. **What does Inmediata do with a malformed 837 file?** Does it reject at the envelope level, segment level? How is it communicated?
20. **How do we handle a 999 rejection vs. a payer-level rejection?**

---

## 🔄 ERA / Remittance (835)

21. **How are ERAs (835) delivered?** Do they come back through `GetRoutedFiles` automatically, or do we need to do something to subscribe?
22. **Which payers send ERAs through you for PR claims?**

---

## 🏝️ Puerto Rico Specific

23. **Any PR-specific requirements** for claim submission (NPI format, taxonomy codes, local payer IDs)?
24. **Do you support Medicaid PR (ASES) through SecureTrack?** If so, what's the payer ID?
25. **Are there any local clearinghouse regulations or PR DOH requirements** we should be aware of?

---

## 🔧 Technical / Integration

26. **Is the WSDL still current?** The guide is from 2021 — are there any new methods or changes we should know about?
27. **What's the max file size for `SendX12File`?**
28. **Do you support TLS 1.3?** The guide mentions up to TLS 1.2.
29. **Is there a dedicated technical contact / integration support team** we can reach when we hit issues?
30. **Do you have a Postman collection, sample code, or client library** to speed up integration?

---

## 📞 Go-Live

31. **What's the estimated timeline from contract signing to live claims?**
32. **Is there a required testing phase, and what does it involve?** (number of test claims, specific scenarios?)
33. **What's the support SLA** for production issues (e.g., claims not processing)?

---

## Priority Questions (If Time Is Short)

Focus on these if the call is short:
1. UAT credentials / access process
2. Payer list for PR
3. ISA envelope values to use
4. Error code catalog
5. Polling frequency recommendations
6. ASES/Medicaid PR support
