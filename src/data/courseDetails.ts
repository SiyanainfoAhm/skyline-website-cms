/* Rich per-course detail taken from the source course pages:
   training package, delivery, entry requirements, careers, duration and fees. */

export type CourseFee = {
  total?: string;
  tuition?: string;
  nonTuition?: string;
  note?: string;
  policyOnly?: boolean;
};

export type CourseDetail = {
  overview: string;
  trainingPackage: string[];
  delivery: string[];
  qualification: string;
  entryRequirements: string[];
  careers: string[];
  furtherStudy?: string;
  durationNotes: string[];
  fee?: CourseFee;
  creditTransfer: string;
  rpl: string;
  disclaimer?: string;
};

const creditTransfer =
  "SLIT will initiate the credit transfer process for a verified certificate or statement of results provided. If credits apply the overall duration will alter and a schedule of exemptions provided.";
const rpl =
  "If the recognition is valid, the overall duration of the study may change, and a list of exceptions may apply.";
const traDisclaimer =
  "Skyline Institute of Technology does not guarantee or take responsibility for the outcome of any individual Skills Assessment submitted to the relevant Assessing Authority (e.g., Trades Recognition Australia – TRA). It is the student's sole responsibility to ensure they meet all eligibility requirements, provide accurate and complete documentation, and comply with the guidelines set by the relevant assessing authority.";

export const courseDetails: Record<string, CourseDetail> = {
  "msf30422-certificate-iii-in-glass-and-glazing": {
    overview:
      "This qualification is ideal for students looking to build skills in the glass and glazing industry, covering work in processing, handling, transporting, and installing a variety of glass products. It supports roles in glazing and specialised glazing across both residential and commercial projects. Students learn practical techniques and job-ready knowledge to complete skilled tasks using standard workplace methods, while also developing the ability to use judgement and adapt their skills to different job requirements, taking responsibility for their work within organisational guidelines.",
    trainingPackage: ["8 Core units", "15 Elective units", "Total of 23 units of competency must be achieved."],
    delivery: [
      "Classroom-based: Face-to-face lectures.",
      "Simulated Workplace: Practical and structural workshops, and team-based projects.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with a MSF30422 Certificate III in Glass and Glazing. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Age: Minimum 18 years.",
      "Academic: There are no formal prerequisites required to enter this qualification. However, students must have Australian Year 12 equivalence or relevant work experience. Mature-age applicants may be considered for admission without meeting the stated minimum educational prerequisites, provided they possess relevant professional experience in the chosen field of study.",
      "Mature-age applicants require evidence of work experience (resumé, reference letters).",
      "English Proficiency: IELTS 6.0 overall (or equivalent). The test result must be valid at the time of enrolment.",
    ],
    careers: ["Residential Glazier", "Commercial Glazier", "Glass Installer / Glazing Technician"],
    furtherStudy:
      "Pathway to CPC50220 Diploma of Building and Construction (Building) or other higher-level construction and trade qualifications, providing opportunities to move into supervisory or management roles.",
    durationNotes: [
      "Total Duration: 52 Weeks (including scheduled breaks)",
      "42 Weeks of scheduled study/tuition.",
      "10 Weeks of scheduled breaks/holidays.",
    ],
    fee: { total: "AUD $15,500.00", tuition: "$14,000.00", nonTuition: "$1,500.00" },
    creditTransfer,
    rpl,
    disclaimer: traDisclaimer,
  },
  "msf30322-certificate-iii-in-cabinet-making-and-timber-technology": {
    overview:
      "This qualification is for students who want to start or build a career in the cabinet making and timber industry. It covers the skills needed to manufacture, assemble, install, and repair cabinetry and timber products for residential and commercial projects, including kitchens, wardrobes, furniture, and interior fit-outs. Students learn practical, hands-on techniques using industry tools and equipment, while developing the knowledge to work safely, follow job specifications, and produce high-quality finished timber work to workplace standards.",
    trainingPackage: ["8 Core units", "17 Elective units", "Total of 25 units of competency must be achieved."],
    delivery: [
      "Classroom-based: Face-to-face lectures.",
      "Simulated Workplace: Practical and structural workshops, and team-based projects.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with a MSF30322 Certificate III in Cabinet Making and Timber Technology. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Age: Minimum 18 years.",
      "Academic: There are no formal prerequisites required to enter this qualification. However, students must have Australian Year 12 equivalence or relevant work experience. Mature-age applicants may be considered for admission without meeting the stated minimum educational prerequisites, provided they possess relevant professional experience in the chosen field of study.",
      "Mature-age applicants require evidence of work experience (resumé, reference letters).",
      "English Proficiency: IELTS 6.0 overall (or equivalent). The test result must be valid at the time of enrolment.",
    ],
    careers: ["Residential Cabinet Maker", "Commercial Cabinet Maker / Joiner", "Furniture Maker / Shopfitter & Installer"],
    furtherStudy:
      "Pathway to CPC50220 Diploma of Building and Construction (Building) or other higher-level construction and trade qualifications, providing opportunities to move into supervisory or management roles.",
    durationNotes: [
      "Total Duration: 52 Weeks (including scheduled breaks)",
      "42 Weeks of scheduled study/tuition.",
      "10 Weeks of scheduled breaks/holidays.",
    ],
    fee: { total: "AUD $15,500.00", tuition: "$14,000.00", nonTuition: "$1,500.00" },
    creditTransfer,
    rpl,
    disclaimer: traDisclaimer,
  },
  "cpc50220-diploma-of-building-and-construction-building": {
    overview:
      "This qualification reflects the role of building professionals who apply specialised knowledge and practical skills to manage and supervise residential and commercial construction projects. Individuals in these roles plan, coordinate, and oversee construction work, manage contractors, contracts, budgets, and quality, and ensure compliance with safety and building standards. This qualification supports career pathways such as Builder, General Foreperson, or Building Inspector.",
    trainingPackage: ["24 Core units", "3 Elective units", "Total of 27 units of competency must be achieved."],
    delivery: [
      "Classroom-based: Face-to-face lectures.",
      "Simulated Workplace: Practical and structural workshops, and team-based projects.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with a CPC50220 Diploma of Building and Construction (Building). For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Age: Minimum 18 years.",
      "Academic: To meet the academic entry requirements, students must have successfully completed CPC40110/CPC40220 Certificate IV in Building and Construction; or CPC30211/CPC30220 Certificate III in Carpentry; or a Certificate III level trade or engineering course.",
      "Mature-age applicants may be considered for admission without meeting the stated minimum educational prerequisites, provided they possess relevant professional experience. Mature-age applicants require evidence of work experience (resumé, reference letters).",
      "English Proficiency: IELTS 6.0 overall (or equivalent). The test result must be valid at the time of enrolment.",
    ],
    careers: ["Builder", "General Foreperson", "Building Inspector"],
    furtherStudy:
      "Many participants who complete CPC50220 Diploma of Building and Construction (Building) may pursue degree level qualifications and research opportunities within the building and construction industry.",
    durationNotes: [
      "72 Weeks of course duration consisting of:",
      "60 Weeks of scheduled study/tuition (6 Terms of 10 Weeks).",
      "12 Weeks of scheduled breaks/holidays.",
      "A minimum of 20 contact hours per week of study/tuition have been scheduled by SLIT to ensure students meet their student study Visa conditions.",
    ],
    fee: { total: "$18,000", tuition: "$16,000", nonTuition: "$2,000", note: "Course fees do not include laptops or software." },
    creditTransfer,
    rpl,
    disclaimer: traDisclaimer,
  },
  "cpc30620-certificate-iii-in-painting-and-decorating": {
    overview:
      "This qualification reflects the role of skilled tradespeople who apply specialised knowledge and practical skills in painting and decorating for residential and commercial construction. Individuals in these roles prepare surfaces, apply paints and coatings, and finish interior and exterior structures to meet industry standards. This qualification supports career pathways such as Painter and Decorator.",
    trainingPackage: ["26 Core units", "3 Elective units", "Total of 29 units of competency must be achieved."],
    delivery: [
      "Classroom-based: Face-to-face lectures.",
      "Simulated Workplace: Practical and structural workshops, and team-based projects.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with a CPC30620 Certificate III in Painting and Decorating. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Age: Minimum 18 years.",
      "Academic: There are no formal prerequisites required to enter this qualification. However, students must have Australian Year 12 equivalence or relevant work experience. Mature-age applicants may be considered for admission without meeting the stated minimum educational prerequisites, provided they possess relevant professional experience in the chosen field of study.",
      "Mature-age applicants require evidence of work experience (resumé, reference letters).",
      "English Proficiency: IELTS 6.0 overall (or equivalent). The test result must be valid at the time of enrolment.",
    ],
    careers: ["Painter and Decorator", "Residential Painting and Decorating Tradesperson", "Commercial Painting and Decorating Tradesperson"],
    furtherStudy:
      "Pathway to CPC50220 Diploma of Building and Construction (Building) or other higher-level construction and trade qualifications, providing opportunities to move into supervisory or management roles.",
    durationNotes: [
      "60 Weeks of course duration consisting of:",
      "50 Weeks of scheduled study/tuition (5 Terms of 10 Weeks).",
      "10 Weeks of scheduled breaks/holidays.",
      "A minimum of 20 contact hours per week of study/tuition have been scheduled by SLIT to ensure students meet their student study Visa conditions.",
    ],
    fee: { total: "$15,500", tuition: "$14,000", nonTuition: "$1,500", note: "Course fees do not include laptops or software." },
    creditTransfer,
    rpl,
    disclaimer: traDisclaimer,
  },
  "cpc30220-certificate-iii-in-carpentry": {
    overview:
      "This qualification reflects the role of skilled tradespeople who apply comprehensive knowledge and practical skills in the field of carpentry across residential and commercial projects. Individuals in these roles plan, construct, assemble, install, and repair structures and fixtures using both timber and non-timber materials. This qualification supports career pathways such as Residential Carpenter, Commercial Carpenter, or Formwork Carpenter.",
    trainingPackage: ["27 Core units", "7 Elective units", "Total of 34 units of competency must be achieved."],
    delivery: [
      "Classroom-based: Face-to-face lectures.",
      "Simulated Workplace: Practical and structural workshops, and team-based projects.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with a CPC30220 Certificate III in Carpentry. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Age: Minimum 18 years.",
      "Academic: There are no formal prerequisites required to enter this qualification. However, students must have Australian Year 12 equivalence or relevant work experience. Mature-age applicants may be considered for admission without meeting the stated minimum educational prerequisites, provided they possess relevant professional experience in the chosen field of study.",
      "Mature-age applicants require evidence of work experience (resumé, reference letters).",
      "English Proficiency: IELTS 6.0 overall (or equivalent). The test result must be valid at the time of enrolment.",
    ],
    careers: ["Residential Carpenter", "Commercial Carpenter", "Formwork Carpenter"],
    furtherStudy:
      "Pathway to CPC50220 Diploma of Building and Construction (Building) or other higher-level construction and trade qualifications, providing opportunities to move into supervisory or management roles.",
    durationNotes: [
      "60 Weeks of course duration consisting of:",
      "50 Weeks of scheduled study/tuition (5 Terms of 10 Weeks).",
      "10 Weeks of scheduled breaks/holidays.",
      "A minimum of 20 contact hours per week of study/tuition have been scheduled by SLIT to ensure students meet their student study Visa conditions.",
    ],
    fee: { total: "$15,500", tuition: "$14,000", nonTuition: "$1,500", note: "Course fees do not include laptops or software." },
    creditTransfer,
    rpl,
    disclaimer: traDisclaimer,
  },
  "rii50520-diploma-of-civil-construction-design": {
    overview:
      "This qualification is for individuals who work as engineering designers or design paraprofessionals, providing essential support to professional engineers. These professionals operate with a high degree of autonomy, exercising considerable judgment when planning and selecting appropriate equipment, roles, and techniques for their own work and for others. A key responsibility includes developing site-specific work designs that precisely align with client requirements.",
    trainingPackage: ["A total of 20 Elective units."],
    delivery: [
      "Classroom-based: Face-to-face lectures.",
      "Simulated Workplace: Practical CAD/BIM labs, structural analysis workshops, and team-based design projects.",
    ],
    qualification:
      "On successful completion, graduates receive the RII50520 Diploma of Civil Construction Design, a nationally accredited qualification under the Australian Qualifications Framework (AQF). This certification validates expertise in civil design compliance, engineering mechanics, and project leadership.",
    entryRequirements: [
      "Age: Minimum 18 years.",
      "Academic: There are no formal prerequisites required to enter this qualification. However, students must have Australian Year 12 equivalence or relevant work experience. Mature-age applicants may be considered for admission without meeting the stated minimum educational prerequisites, provided they possess relevant professional experience in the chosen field of study.",
      "Mature-age applicants require evidence of work experience (resumé, reference letters).",
      "English Proficiency: IELTS 6.0 overall (or equivalent). The test result must be valid at the time of enrolment.",
    ],
    careers: ["Civil Construction Design Draftsperson", "Senior Civil Works Designer", "Infrastructure Project Coordinator"],
    furtherStudy: "Pathway to RII60520 Advanced Diploma of Civil Construction Design.",
    durationNotes: [
      "Total Duration: 60 weeks (including scheduled breaks).",
      "Duration may reduce with Recognition of Prior Learning (RPL) or Credit Transfers.",
    ],
    fee: { total: "AUD $18,500.00", tuition: "$16,000.00", nonTuition: "$2,500.00", note: "Laptops and specialised software not included." },
    creditTransfer,
    rpl,
    disclaimer:
      "Skyline Institute of Technology does not guarantee or take responsibility for the outcome of any individual Skills Assessment submitted to Assessing Authority (i.e., EA). It is the student's sole responsibility to ensure they meet all eligibility requirements, provide accurate and complete documentation, and comply with the guidelines set by the relevant assessing authority.",
  },
  "rii60520-advanced-diploma-of-civil-construction-design-52weeks": {
    overview:
      "This qualification reflects the role of an individual working as a senior civil works designer or a para-professional designer, who supports professional engineers. They perform tasks that are broad, specialised, complex and technical and include strategic areas and initiating activities. They are responsible for the design of complex projects and are required to demonstrate self-directed application of theoretical and technical knowledge.",
    trainingPackage: ["5 Core units", "7 Elective units", "Total of 12 units of competency must be achieved."],
    delivery: [
      "Classroom-based: Face-to-face lectures.",
      "Simulated workplace environment (the units of competency will be delivered in this context).",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with a RII60520 Advanced Diploma of Civil Construction Design. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Age: Minimum 18 years.",
      "Academic: To meet the academic entry requirements, students must have successfully completed RII50520 Diploma of Civil Construction Design. This qualification serves as a prerequisite and must be completed prior to commencing the Advanced Diploma.",
      "English Proficiency: IELTS 6.0 overall (or equivalent). The test result must be valid at the time of enrolment.",
    ],
    careers: [
      "Civil Construction Designer",
      "Construction Project Manager",
      "Senior Civil Design Draftsperson",
      "Geotechnical Design Technician",
      "Urban Road Design Specialist",
    ],
    furtherStudy: "This qualification provides a strong foundation for further study in civil engineering or construction-related degree programs.",
    durationNotes: [
      "Total Duration: 52 Weeks (including scheduled breaks)",
      "40 Weeks of scheduled study/tuition (4 Terms of 10 Weeks).",
      "12 Weeks of scheduled breaks/holidays.",
      "The total course duration may be reduced if credit transfer is granted based on prior qualifications or units completed.",
    ],
    fee: { total: "AUD $16,000.00", tuition: "$14,000.00", nonTuition: "$2,000.00", note: "Course fees do not include laptops or software." },
    creditTransfer,
    rpl,
  },
  "rii60520-advanced-diploma-of-civil-construction-design": {
    overview:
      "This qualification reflects the role of an individual working as a senior civil works designer or a para-professional designer, who supports professional engineers. They perform tasks that are broad, specialised, complex and technical and include strategic areas and initiating activities. They are responsible for the design of complex projects and are required to demonstrate self-directed application of theoretical and technical knowledge.",
    trainingPackage: ["5 Core units", "7 Elective units", "Total of 12 units of competency must be achieved."],
    delivery: [
      "Classroom-based: Face-to-face lectures.",
      "Simulated workplace environment (the units of competency will be delivered in this context).",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with a RII60520 Advanced Diploma of Civil Construction Design. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Age: Minimum 18 years.",
      "Academic: There are no formal prerequisites required to enter this qualification. Students must be at least 18 years of age and have completed Australian Year 12 or equivalent of other countries.",
      "Mature Age students will also be considered without the minimum education requirements providing they have relevant work experience within the chosen area of study. A minimum of 5 years' experience would normally be expected.",
      "English Proficiency: IELTS 6.0 overall (or equivalent). The test result must be valid at the time of enrolment.",
    ],
    careers: ["Civil Construction Designer", "Construction Project Manager", "Senior Civil Design Draftsperson", "Geotechnical Design Technician", "Urban Road Design Specialist"],
    furtherStudy: "This qualification provides a strong foundation for further study in civil engineering or construction-related degree programs.",
    durationNotes: [
      "104 Weeks of course duration consisting of:",
      "80 Weeks of scheduled study/tuition (8 Terms of 10 Weeks).",
      "24 Weeks of scheduled breaks/holidays.",
      "A minimum of 20 contact hours per week of study/tuition have been scheduled by SLIT to ensure students meet their student study Visa conditions.",
    ],
    fee: { total: "$25,000", tuition: "$22,000", nonTuition: "$3,000", note: "Course fees do not include laptops or software." },
    creditTransfer,
    rpl,
  },
  "certificate-iii-in-light-vehicle-mechanical-technology": {
    overview:
      "This qualification reflects the role of individuals who perform a broad range of tasks on a variety of light vehicles in the automotive retail, service and repair industry.",
    trainingPackage: ["20 Core units", "16 Elective units", "Total of 36 units of competency must be achieved."],
    delivery: [
      "Classroom based / Face to Face delivery (via Microsoft Teams group video conferencing platform) and simulated workplace environment.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with an AUR30620 Certificate III in Light Vehicle Mechanical Technology. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Students must be over 18 years of age.",
      "Academic: There are no formal prerequisites required to enter this qualification. Satisfactory completion of studies in the applicant's home country equivalent to an Australian Year 12 qualification is required for entry into all qualifications.",
      "English Proficiency: IELTS band score of overall 6 (Academic or General) or equivalent, or Pearson Test of English Academic (PTE) Score 52. The test result must be no older than 2 years as of date of application.",
    ],
    careers: [
      "Graduates may perform a broad range of tasks on a variety of light vehicles in the automotive retail, service and repair industry.",
    ],
    furtherStudy:
      "Successful completion of the AUR30620 Certificate III in Light Vehicle Mechanical Technology will lay a foundation for successful students to progress into AUR40216 Certificate IV in Automotive Mechanical Diagnosis or other relevant qualifications.",
    durationNotes: [
      "66 Weeks of course duration consisting of:",
      "52 Weeks (1040 Delivery and 200 Self-study Hours) of scheduled study/tuition (4 Terms of 10 Weeks & 1 Term of 12 Weeks).",
      "14 Weeks of scheduled breaks/holidays.",
      "A minimum of 20 contact hours per week of study/tuition have been scheduled by SLIT to ensure students meet their student study Visa conditions.",
    ],
    fee: { total: "$16,000", tuition: "$15,000", nonTuition: "$1,000", note: "Course fees do not include laptops or software." },
    creditTransfer,
    rpl,
  },
  "certificate-iv-in-automotive-mechanical-diagnosis": {
    overview:
      "This qualification covers the skills and knowledge required to perform advanced diagnostic operations in the automotive retail, service and repair environment.",
    trainingPackage: ["1 Core unit", "9 Elective units", "Total of 10 units of competency must be achieved."],
    delivery: [
      "Classroom based / Face to Face delivery (via Microsoft Teams group video conferencing platform) and simulated workplace environment.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with an AUR40216 Certificate IV in Automotive Mechanical Diagnosis. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Students must be over 18 years of age.",
      "Academic: Those undertaking AUR40216 Certificate IV in Automotive Mechanical Diagnosis are required to have completed an automotive mechanical Certificate III qualification or be able to demonstrate equivalent.",
      "English Proficiency: IELTS band score of overall 6 (Academic or General) or equivalent, or Pearson Test of English Academic (PTE) Score 52. The test result must be no older than 2 years as of date of application.",
    ],
    careers: ["Automotive lead or master technician", "Automotive technical adviser"],
    furtherStudy:
      "Successful completion of the AUR40216 Certificate IV in Automotive Mechanical Diagnosis will lay a foundation for successful students to progress into AUR50216 Diploma of Automotive Technology or other relevant qualifications.",
    durationNotes: [
      "36 Weeks of course duration consisting of:",
      "30 Weeks of scheduled study/tuition (3 Terms of 10 Weeks).",
      "6 Weeks of scheduled breaks/holidays.",
      "A minimum of 20 contact hours per week of study/tuition have been scheduled by SLIT to ensure students meet their student study Visa conditions.",
    ],
    fee: { total: "$9,750", tuition: "$9,000", nonTuition: "$750", note: "Course fees do not include laptops or software." },
    creditTransfer,
    rpl,
  },
  "diploma-of-business": {
    overview:
      "This qualification reflects the role of individuals in a variety of Business Services job roles. These individuals may have frontline management accountabilities. Individuals in these roles carry out moderately complex tasks in a specialist field of expertise that requires business operations skills. They may possess substantial experience in a range of settings, but seek to further develop their skills across a wide range of business functions.",
    trainingPackage: ["5 Core units", "7 Elective units", "Total of 12 units of competency must be achieved."],
    delivery: [
      "Classroom based / Face to Face delivery (via Microsoft Teams group video conferencing platform) and simulated workplace environment.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with a BSB50120 Diploma of Business. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Students must be over 18 years of age.",
      "Academic: There are no formal prerequisites required to enter this qualification. Satisfactory completion of studies in the applicant's home country equivalent to an Australian Year 12 qualification is required for entry into all qualifications.",
      "English Proficiency: IELTS band score of overall 6 (Academic or General) or equivalent, or Pearson Test of English Academic (PTE) Score 52. The test result must be no older than 2 years as of date of application.",
    ],
    careers: [
      "Business Development Manager",
      "Office Manager",
      "Business Sales Team Leader",
      "Administrator",
      "Corporate Services Manager",
      "Administration Manager",
    ],
    furtherStudy:
      "Successful completion of the BSB50120 Diploma of Business will lay a foundation for successful students to progress into Advanced Diploma, Graduate Diploma and Higher Education/Tertiary courses.",
    durationNotes: [
      "52 Weeks of course duration consisting of:",
      "42 Weeks of scheduled study/tuition (4 Terms of 10 Weeks, 1 Term of 2 weeks).",
      "10 Weeks of scheduled breaks/holidays.",
      "A minimum of 20 contact hours per week of study/tuition have been scheduled by SLIT to ensure students meet their student study Visa conditions.",
    ],
    fee: { total: "$11,000", tuition: "$10,000", nonTuition: "$1,000", note: "Course fees do not include laptops or software." },
    creditTransfer,
    rpl,
  },
  "ict60220-advanced-diploma-of-information-technology": {
    overview:
      "This qualification reflects the role of individuals in a variety of information and communications technology (ICT) roles who have significant experience in specialist technical skills, or managerial business and people management skills. Individuals in these roles carry out complex tasks in a specialist field, working independently, leading a team or a strategic direction of a business.",
    trainingPackage: ["6 Core units", "10 Elective units", "Total of 16 units of competency must be achieved."],
    delivery: [
      "Classroom based / Face to Face delivery (via Microsoft Teams group video conferencing platform) and simulated workplace environment.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with an ICT60220 Advanced Diploma of Information Technology. For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Students must be over 18 years of age.",
      "Academic: There are no formal prerequisites required to enter this qualification. Students must have completed Australian Year 12 or equivalent of other countries. Mature Age students will also be considered without the minimum education requirements providing they have relevant work experience within the chosen area of study.",
      "English Proficiency: IELTS 6.0 overall (Academic or General) or equivalent, or Pearson Test of English Academic (PTE) Score 52.",
    ],
    careers: [
      "Information Technology Sector roles",
      "Telecommunication Network Engineer",
      "Pathway to Information Systems Networking and Telecommunications qualifications",
    ],
    furtherStudy:
      "This course provides a pathway to higher-level qualifications in Information Systems Networking and Telecommunications and Information Technology Networks.",
    durationNotes: [
      "104 Weeks of course duration consisting of:",
      "80 Weeks of scheduled study/tuition (8 Terms of 10 Weeks).",
      "24 Weeks of scheduled breaks/holidays.",
      "A minimum of 20 contact hours per week of study/tuition have been scheduled by SLIT to ensure students meet their student study Visa conditions.",
    ],
    fee: { total: "$25,000", tuition: "$22,000", nonTuition: "$3,000", note: "Course fees do not include laptops or software." },
    creditTransfer,
    rpl,
  },
  "bsb80120-graduate-diploma-of-management-learning": {
    overview:
      "This qualification reflects the role of individuals who apply highly specialised knowledge and skills in the field of organisational learning and capability development. Individuals in these roles generate and evaluate complex ideas. They also initiate, design, and execute major learning and development functions within an organisation. The job roles that relate to this qualification may include RTO Manager and RTO Director.",
    trainingPackage: ["3 Core units", "5 Elective units", "Total of 8 units of competency must be achieved."],
    delivery: [
      "Classroom based / Face to Face delivery (via Microsoft Teams group video conferencing platform) and simulated workplace environment.",
    ],
    qualification:
      "Upon the successful completion of all Units of Competency for this qualification participants will be issued with a BSB80120 Graduate Diploma of Management (Learning). For partial completion of this qualification, students will be issued with a Statement of Attainment indicating completed Units of Competency.",
    entryRequirements: [
      "Applicant must be over 18 years of age.",
      "This qualification is available to domestic students only and is not available for enrolment by international students on a Student visa.",
      "Academic: There are no formal prerequisites required to enter this qualification. Students must be at least 18 years of age and have completed Australian Year 12 or equivalent of other countries.",
      "Mature Age students will also be considered without the minimum education requirements providing they have relevant work experience within the chosen area of study (a minimum of 5 years' experience would normally be expected).",
    ],
    careers: [
      "Business Development Manager",
      "Office Manager",
      "Business Sales Team Leader",
      "Administrator",
      "Corporate Services Manager",
      "Administration Manager",
    ],
    furtherStudy:
      "Completion of the BSB80120 Graduate Diploma of Management (Learning) will lay a foundation to progress into BSB80215 Graduate Diploma of Strategic Leadership, Masters of Business Administration, or any other relevant Masters Degree.",
    durationNotes: [
      "52 Weeks of course duration consisting of:",
      "40 Weeks of scheduled study/tuition (4 Terms of 10 Weeks).",
      "12 Weeks of scheduled breaks/holidays.",
      "A minimum of 20 contact hours per week of study/tuition have been scheduled by SLIT to ensure students meet their student study Visa conditions.",
    ],
    fee: { policyOnly: true },
    creditTransfer,
    rpl,
  },
};

export const getCourseDetail = (slug: string): CourseDetail | undefined => courseDetails[slug];