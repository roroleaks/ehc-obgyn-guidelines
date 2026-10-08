const fs = require('fs');
const path = require('path');

const GUIDELINES_FILE = path.join(__dirname, '..', 'guidelines.json');
const g = JSON.parse(fs.readFileSync(GUIDELINES_FILE, 'utf8'));

// Helper to add phrase to a book by bookId if not already present
function addPhrase(bookId, phrase) {
  const guide = g.guidelines.find(b => b.bookId === bookId);
  if (!guide) {
    console.warn(`Book ${bookId} not found!`);
    return;
  }
  if (!guide.phrases.includes(phrase)) {
    guide.phrases.push(phrase);
    console.log(`Added to Book ${bookId}: ${phrase.slice(0, 60)}...`);
  }
}

// 1. Book 252 (Non-Clinical Interventions)
addPhrase(252, "For women requesting cesarean section without medical indication, explore the reasons for maternal request, offer psychological support, and discuss risks and benefits. (Strong)");
addPhrase(252, "Establish clinical quality improvement audit committees to review cesarean indications and maternal outcomes using the Robson classification system. (Strong)");

// 2. Book 646 (Robson Classification / 10-group classification)
addPhrase(646, "Categorize women into Robson groups based on parity (nulliparous vs multiparous), gestational age, fetal presentation, and onset of labor. (Strong)");
addPhrase(646, "Auditing cesarean section rates by Robson groups helps evaluate perinatal outcomes and maternal or neonatal morbidity across maternity units. (Strong)");

// 3. Book 652 (Ectopic Pregnancy & PUL)
addPhrase(652, "In women with pregnancy of unknown location (PUL), obtain serial serum hCG measurements 48 hours apart and calculate the progesterone/hCG ratio. (Strong)");
addPhrase(652, "For interstitial or cornual pregnancy, laparoscopy or laparotomy with cornual resection or cornuostomy is recommended depending on hemodynamic stability. (Strong)");
addPhrase(652, "Interstitial pregnancy should be suspected when an eccentric gestational sac is identified high in the uterine fundus with thin surrounding myometrium. (Strong)");
addPhrase(652, "In women undergoing assisted reproductive technology presenting with pelvic pain or bleeding, maintain high suspicion for heterotopic pregnancy. (Strong)");
addPhrase(652, "Women who conceive via IVF or other assisted reproduction technologies are at higher risk for ectopic and heterotopic pregnancy. (Strong)");
addPhrase(652, "Laparoscopic salpingectomy is the preferred surgical treatment for tubal ectopic pregnancy in the presence of extensive tubal damage or contralateral healthy tube. (Strong)");

// 4. Book 653 (Hypertension in Pregnancy)
addPhrase(653, "Implement the Modified Early Obstetric Warning Score (MEOWS) chart for all inpatient obstetric admissions to ensure early detection of maternal deterioration. (Strong)");
addPhrase(653, "Fetal growth restriction should be monitored with serial ultrasound biometry and umbilical artery Doppler assessment in women with hypertensive disorders. (Strong)");
addPhrase(653, "Thromboprophylaxis with low-molecular-weight heparin (LMWH) should be administered to hospitalized women with severe hypertension or immobility. (Strong)");
addPhrase(653, "Ensure close postnatal monitoring of maternal blood pressure, urinalysis, and symptoms during the first 72 hours after delivery. (Strong)");

// 5. Book 656 (PAS)
addPhrase(656, "Intraoperative cell salvage is recommended in placenta accreta spectrum surgery where massive hemorrhage is anticipated. (Strong)");
addPhrase(656, "Prophylactic balloon catheter placement by interventional radiology may be considered in selected high-risk placenta accreta spectrum cases. (Conditional)");
addPhrase(656, "Placenta accreta spectrum includes placenta creta, placenta increta (invading the myometrium), and placenta percreta (invading through the serosa). (Strong)");
addPhrase(656, "Preoperative ureteric stents placement should be considered when significant bladder or lower uterine segment invasion is suspected in placenta accreta. (Conditional)");

// 6. Book 665 (Endometriosis)
addPhrase(665, "In women with deep endometriosis and significant concomitant adenomyosis, GnRH agonist therapy or surgical intervention should be considered based on symptom severity. (Conditional)");
addPhrase(665, "Clinicians should consider extra-pelvic endometriosis in women presenting with cyclical non-gynecological symptoms such as catamenial pneumothorax or cyclical sciatica. (Conditional)");

// 7. Book 670 (Prevention of Primary CS)
addPhrase(670, "External cephalic version (ECV) should be offered to all women with an uncomplicated singleton breech presentation at 36 weeks of gestation or beyond. (Strong)");
addPhrase(670, "Mechanical methods of induction, such as a Foley catheter balloon, are recommended as a safe and effective option for cervical ripening. (Strong)");
addPhrase(670, "Prostaglandin agents such as dinoprostone or oral misoprostol are recommended pharmacological options for labor induction and cervical ripening. (Strong)");
addPhrase(670, "Safe prevention of primary cesarean section requires avoiding labor dystocia overdiagnosis in the latent first stage of labor. (Strong)");

// 8. Book 713 (PPH)
addPhrase(713, "Uterine massage and bimanual uterine compression are immediate first-line physical measures to manage postpartum hemorrhage due to uterine atony. (Strong)");

// 9. Book 716 (Nausea & Vomiting / Hyperemesis)
addPhrase(716, "Hospital admission for rehydration and antiemetics is indicated in women with hyperemesis gravidarum who have ketonuria, weight loss > 5%, or electrolyte imbalance. (Strong)");

// 10. Book 744 (Normal Labor)
addPhrase(744, "Excessive intake of hypotonic intravenous fluids during labor must be avoided to prevent maternal and fetal hyponatremia. (Strong)");
addPhrase(744, "Operative vaginal birth with vacuum or forceps should be performed by experienced operators when indicated for fetal compromise or prolonged second stage. (Strong)");
addPhrase(744, "Vacuum extraction is an effective operative vaginal birth method to facilitate delivery in the second stage of labor when traction is required. (Strong)");
addPhrase(744, "Perineal repair should be performed using continuous suturing for the vaginal mucosa and perineal muscles to reduce postpartum pain compared to interrupted sutures. (Strong)");
addPhrase(744, "Administer anti-D immunoglobulin within 72 hours of birth to Rh-negative unsensitized mothers who deliver an Rh-positive baby. (Strong)");
addPhrase(744, "In women with spontaneous rupture of membranes (SROM) at term, assess liquor color and fetal heart rate, and avoid digital vaginal examinations if labor has not started. (Strong)");
addPhrase(744, "Shoulder dystocia should be managed systematically by calling for senior help, performing the McRoberts maneuver, and applying suprapubic pressure. (Strong)");

// 11. Book 771 (Preterm Labor)
addPhrase(771, "Offer women with PPROM oral erythromycin 250 mg 4 times a day for a maximum of 10 days or until the woman is in established labor. (Strong)");
addPhrase(771, "In women with preterm prelabor rupture of membranes (PPROM), expectant management with antibiotic prophylaxis and surveillance for chorioamnionitis is recommended before 34 weeks. (Strong)");
addPhrase(771, "Consider quantitative fetal fibronectin testing in combination with cervical length measurement to assess the risk of spontaneous preterm birth in symptomatic women. (Conditional)");
addPhrase(771, "Antenatal corticosteroids and planned delivery timing are crucial clinical interventions to reduce respiratory distress syndrome and neonatal morbidity. (Strong)");
addPhrase(771, "Administer antenatal betamethasone (12 mg IM 24 hours apart) or dexamethasone (6 mg IM 12 hours apart, 4 doses) to accelerate fetal lung maturation. (Strong)");
addPhrase(771, "Tocolytic therapy with nifedipine (or indomethacin / atosiban) is recommended for up to 48 hours to permit completion of antenatal corticosteroids and transfer. (Strong)");

fs.writeFileSync(GUIDELINES_FILE, JSON.stringify(g, null, 2) + '\n');
console.log('Enrichment completed successfully!');
