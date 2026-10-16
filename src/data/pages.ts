export type Block =
  | { type: "paragraphs"; heading?: string; paragraphs: string[] }
  | { type: "list"; heading?: string; items: string[] }
  | { type: "links"; heading?: string; items: { label: string; href: string; external?: boolean }[] }
  | { type: "table"; heading?: string; columns: string[]; rows: string[][] }
  | { type: "media"; heading?: string; items: { image: string; alt: string; caption?: string }[] }
  | { type: "features"; heading?: string; items: { title: string; icon: string }[] };

export type ContentPageData = {
  slug: string;
  breadcrumb: string;
  title: string;
  lead?: string;
  showNews?: boolean;
  blocks: Block[];
};

export const aboutPage: ContentPageData = {
  slug: "about-us",
  breadcrumb: "About Us",
  title: "About Us",
  showNews: true,
  blocks: [
    {
      type: "paragraphs",
      heading: "A Few Words About the Skyline Institute",
      paragraphs: [
        "Skyline Institute is at the forefront of delivering exceptional technical education and training in various professions and industries. Our commitment lies in equipping businesses with the necessary skills and talents to excel, while also assisting individuals in their career journeys, regardless of whether they are embarking on a new path or advancing further.",
        "Our approach involves empowering students from diverse backgrounds, as they represent the future's trailblazers and visionaries. Through our outstanding technical education and hands-on opportunities, we provide them with the tools they need to succeed in their careers and make a positive impact in the world.",
      ],
    },
    {
      type: "media",
      items: [
        {
          image:
            "https://wpdemo.zcubethemes.com/qeducato/wp-content/uploads/2023/03/about_img_05.png",
          alt: "Empowering the Future at Skyline Institute of Technology",
          caption: "Empowering the Future",
        },
        {
          image:
            "https://wpdemo.zcubethemes.com/qeducato/wp-content/uploads/2023/03/steps-img-2.png",
          alt: "Campus Tour at Skyline Institute of Technology",
          caption: "Campus Tour",
        },
        {
          image:
            "https://wpdemo.zcubethemes.com/qeducato/wp-content/uploads/2023/03/steps-img-3.png",
          alt: "Powerful Alumni of Skyline Institute of Technology",
          caption: "Powerful Alumni",
        },
      ],
    },
  ],
};

export const informationPage: ContentPageData = {
  slug: "information",
  breadcrumb: "Information",
  title: "Information",
  blocks: [
    { type: "paragraphs", heading: "Pre-Departure Information", paragraphs: [] },
    {
      type: "list",
      heading: "Before you leave your home country",
      items: [
        "Confirm your enrolment and start date with SKYLINE INSTITUTE OF TECHNOLOGY",
        "Check if SKYLINE INSTITUTE OF TECHNOLOGY has an airport greeting service.",
        "Arrange for immunizations and medications from your doctor.",
        "Apply for a credit card and/or arrange for sufficient funds to be available for you to access in Australia. Confirm overseas access to your funds with your bank.",
        "Make travel arrangements, including insurance.",
        "Advise SKYLINE INSTITUTE OF TECHNOLOGY of your travel details.",
        "Arrange accommodation for at least your first week in Australia, if not longer.",
        "Arrange transport from the airport to your accommodation, and change enough currency into Australian dollars before you leave so that you can catch a taxi or make a phone call in the event of an emergency.",
        "When packing your bags, make sure you include the name and contact details of SKYLINE INSTITUTE OF TECHNOLOGY’s international representative.",
      ],
    },
    {
      type: "list",
      heading: "Bring these Documents",
      items: [
        "Prepare a folder of official documents to bring with you to Australia, including:",
        "Valid passport and student visa confirmation letter",
        "SKYLINE INSTITUTE OF TECHNOLOGY’s offer of a place/admission letter",
        "Electronic Confirmation of Enrolment (eCoE)",
        "Receipts of payments (e.g. tuition fees, OSHC, bank statements)",
        "Insurance policies",
        "Original or certified copies of your academic transcripts and qualifications",
        "Other personal identification documents (e.g. birth certificate, ID card, driver’s licence)",
        "Photocopy of credit/debit card(s)",
        "Medical records and prescriptions",
        "Prescriptions and generic names of medications",
        "Reference letters for potential employers/landlord.",
        "Before you leave, make copies of all your documents and leave them with someone at home who can send them on to you if the originals get lost.",
        "When flying, keep all your documents in your carry-on luggage.",
      ],
    },
    {
      type: "paragraphs",
      heading: "Customs and Border Protection",
      paragraphs: [
        "[Provided by Australian Government www.studyinaustralia.gov.au.]",
        "You need to be aware of what you cannot bring into Australia and therefore what you should not pack. It is illegal to carry drugs including marijuana, cannabis, heroin, cocaine and amphetamines in and out of Australia. There are a number of items that you must declare upon your arrival in Australia including:",
      ],
    },
    {
      type: "list",
      items: [
        "Firearms, weapons and ammunition.",
        "Currency amounts of AUD$10,000 (or foreign equivalent).",
        "Some medicines.",
      ],
    },
    {
      type: "paragraphs",
      paragraphs: [
        "You should also be aware that as a routine part of their work, Customs and Border Protection officers may question travelers at any time, and trained dogs may also be used to detect illegal drugs or prohibited imports. If you are in doubt, declare your goods or ask a Customs and Border Protection officer for advice. Declaring goods does not necessarily mean your baggage will be examined.",
        "People who deliberately break Australian Customs and Border Protection regulations could be or taken to court. You can also find information at the Australian Customs and Border Protection Service website.",
      ],
    },
    {
      type: "links",
      items: [
        {
          label: "Australian Customs and Border Protection Service",
          href: "https://www.border.gov.au/about/contact/offices-locations/australia",
          external: true,
        },
      ],
    },
    {
      type: "paragraphs",
      heading: "Agriculture, Fisheries and Forestry",
      paragraphs: [
        "Students are often surprised by how strict the Department of Agriculture, Fisheries and Forestry (DAFF) biosecurity requirements can be.",
        "Live animals and plants, plant material, animal products and some food from overseas could introduce some of the world’s most serious pests and diseases into Australia, devastating our valuable agriculture and tourism industries and unique environment.",
        "So, it’s important to remember that when you’re packing to not bring fresh fruit and vegetables, meat, poultry, pork, eggs, nuts, dairy goods and live plants and seeds, as they will not be allowed into the country.",
        "You can also find information on what you can bring or send to Australia at the DIBP web site.",
        "If you’re in doubt about whether your goods are prohibited or not, declare them on the Incoming Passenger Card which you will receive on the plane. On the spot fines can apply for not declaring items.",
      ],
    },
    {
      type: "paragraphs",
      heading: "On Arrival in Australia",
      paragraphs: [
        "When you first arrive, you will be required to make your way through Australian immigration. An immigration officer will ask to see your completed incoming passenger card (given to you on the plane) and your passport. The immigration officer will check your documents and may ask you a few questions about your planned stay in Australia. You may also have to show your Confirmation of Enrolment.",
        "Once you have cleared the immigration checkpoint you will enter the baggage hall where you can claim your luggage and proceed to Customs and baggage examination.",
        "People arriving in Australia clear Customs through one of two channels: the green channel is for those with ‘nothing to declare’; the red channel for those with ‘something to declare’. You must to declare any food, plant materials and animal products.",
        "Regardless of the channel you follow, your luggage, including your hand luggage, may be x-rayed inspected or checked by a detector dog team.",
        "If you do not have anything to declare, follow the green channel. If you do have something to declare, follow the red channel.",
        "As you go through the red channel of Customs, an official will ask you to open your luggage so that it can be inspected. If the Customs official decides that an item is not quarantined, you will be allowed to keep it and move through the Customs checkpoint. If the item is quarantined, it will either be confiscated and destroyed, or held for decontamination and returned to you at a later date.",
        "If you go through the green channel, you may be subjected to a random check and asked by a Customs’ official to open your luggage for inspection.",
        "Australia has strict quarantine laws so it is important to declare all the items you are carrying on the incoming passenger card. Those who do not declare honestly risk fines and prosecution.",
      ],
    },
    {
      type: "paragraphs",
      heading: "Opening a Bank Account",
      paragraphs: [
        "To open a bank account in Australia must show several pieces of personal identification, each of which is allotted certain number of ‘points’. You will need 100 points of identification to establish your identity as the person who will be named on the account.",
        "Your passport and proof of your arrival date in Australia will be acceptable as 100 points if you open an account within six weeks of arrival in Australia. After this time, you will need additional documentation. To open an account, you’ll also need a minimum deposit (this can be as little as $10).",
      ],
    },
    {
      type: "paragraphs",
      heading: "Accommodation",
      paragraphs: [
        "Finding the right accommodation is one of the biggest challenges facing any new international student, and finding a place in your price range can be even harder. It is extremely important that you factor the high cost of housing into your budget before you come to Australia, and that you are able to access sufficient funds to cover possible rent increases.",
        "A range of accommodation options are available. Our Student Welfare Officer can provide you with more information and links to website for your information. Accommodation may be found nearby to the campus or in Brisbane and train, bus, car or motorcycle used to get to the campus.",
      ],
    },
    {
      type: "paragraphs",
      heading: "Overseas Student Health Cover (OSHC)",
      paragraphs: [
        "Australia has a special system of health cover for international students called Overseas Student Health Cover (OSHC). You will need to buy OSHC before you come to Australia to cover you from when you arrive.",
        "The Department of Immigration and Citizenship requires you to maintain OSHC for the duration of your time on a student visa in Australia.",
      ],
    },
    {
      type: "paragraphs",
      heading: "Culture and Society",
      paragraphs: [
        "In Australia, you may notice some differences in etiquette, lifestyles and values to what you are used to back home. Australians are informal, which can take some adjustment, especially if you are more accustomed to a culture where ritual is important and where levels of status and authority are clearly distinguished and carefully respected. These are not obvious characteristics of Australian culture and you will be expected to be able to accept a wide range of people on an equal basis in informal situations.",
      ],
    },
    {
      type: "paragraphs",
      heading: "Student Visa Conditions",
      paragraphs: [
        "The Department of Immigration and Citizenship (DIBP) is the Australian Government department that manages everything relating to student visas.",
        "It is very important that you are fully aware of, and meet, all the conditions of your visa. Visa conditions are set out in the letter of approval sent with a visa or on a visa label. There may be special conditions for students on scholarships, so if you are on a scholarship, it is important to read and understand all these conditions.",
        "For a full list of mandatory and discretionary student visa conditions, visit www.border.gov.au",
        "Unfortunately, a number of students abuse the law each year. For example, they may work longer hours than permitted by their visa or they may overstay their visa. Breaking these conditions can cause a visa to be cancelled and this has serious consequences: under the law, a student may be required to leave Australia and not allowed to return for three years after the visa is cancelled.",
      ],
    },
    {
      type: "paragraphs",
      heading: "Changing/Extending your visa",
      paragraphs: [
        "If your circumstances change and you want to change your course or provider, or you wish to stay in Australia longer, contact the nearest Department of Immigration and Citizenship (DIBP) office for advice on how to make these arrangements.",
        "It is also important to ensure your visa does not expire while you are in Australia. If you remain in Australia for more than 28 days after your student visa expires without obtaining a new one, you may not be allowed to return for three years.",
        "If your student visa expires before you have finished your course of study, or if you wish undertake further study, you should contact your nearest Australian visa office. You can only extend your stay in Australia if your do not have a “No Further Stay” condition on your current student visa.",
        "If you need help in understanding any of these conditions, contact the Department of Immigration and Citizenship (DIBP), or visit www.border.gov.au",
        "For further information, go to www.border.gov.au and select “Students” from the “Visa, Immigration and Refugees” menu.",
      ],
    },
    {
      type: "links",
      heading: "Further information",
      items: [
        { label: "Department of Home Affairs — www.border.gov.au", href: "https://www.border.gov.au/", external: true },
      ],
    },
  ],
};

export const studentVisaPage: ContentPageData = {
  slug: "student-visa",
  breadcrumb: "Student Visa",
  title: "Student Visa",
  blocks: [
    {
      type: "paragraphs",
      heading: "INTERNATIONAL STUDENT VISA",
      paragraphs: [
        "SKYLINE INSTITUTE OF TECHNOLOGY is a Registered Training Organisation (RTO Code 45989) and a CRICOS Provider (CRICOS Code 04114B) and Regulated by Australian Skills Quality Authority (ASQA). Our aim is to provide exceptional quality education backed by industry experts and experienced faculty. We believe in filling the knowledge gaps in the industry that are ignored by others by providing in depth knowledge.",
        "We offer information on the Australian student visa application, life in Australia, student accommodation, and advice on all the medical requirements and legal aspects of applying for a visa.",
        "Studying overseas is an exciting opportunity for lots of people. With the right visa applications in place and a clear direction, you can enjoy the opportunities to improve your skillset and enjoy new career opportunities. You can also work while studying, enjoy the culture and lifestyle, and make new friends.",
        "Read through the information below, or contact us to enquire about a student visa and how you can apply.",
      ],
    },
    {
      type: "paragraphs",
      heading: "VISA INFORMATION",
      paragraphs: [
        "All international students must possess a current student visa while they are studying any courses in Australia. This information does not apply to prospective students who are Australian citizens or permanent residents of Australia.",
        "If you are applying for a student visa, you need to have been accepted to study full-time by SKYLINE INSTITUTE OF TECHNOLOGY. This application needs to be accompanied by a variety of documents that indicate your financial support while in AUSTRALIA, English language ability, registration for higher education, school reports and health insurance.",
      ],
    },
    {
      type: "paragraphs",
      heading: "HOW DO I APPLY?",
      paragraphs: [
        "Prospective international students intending to study in Australia must obtain a student visa from an Australian High Commission, embassy or consulate in their home country before travelling.",
        "Students can also apply for and Australian visa online. To find out if you are eligible, visit http://www.homeaffairs.gov.au/Trav/Stud.",
        "All international students must comply with current visa conditions and regulations determined by DIBP.",
        "To assist students in applying for a student visa, SKYLINE INSTITUTE OF TECHNOLOGY has appointed Education Agents.",
      ],
    },
    {
      type: "paragraphs",
      heading: "WHAT ARE THE VISA REQUIREMENTS?",
      paragraphs: ["There are requirements that must be met before a student visa is issued, and these vary from country to country. The main requirements for a visa application may include:"],
    },
    {
      type: "list",
      items: [
        "A Letter of Offer from SKYLINE INSTITUTE OF TECHNOLOGY",
        "An electronic Confirmation of Enrolment (CoE) from SKYLINE INSTITUTE OF TECHNOLOGY (this is issued after you have paid your first installment, and other required fees as stated on the Offer Letter)",
        "A medical check-up",
        "Proof of academic history and English proficiency",
        "Proof of financial support",
      ],
    },
    {
      type: "paragraphs",
      heading: "WHAT ARE THE VISA CONDITIONS?",
      paragraphs: ["To maintain your visa, you must:"],
    },
    {
      type: "list",
      items: [
        "Study full time while in Australia.",
        "Attend at least 80% of all scheduled classes.",
        "Maintain satisfactory academic progress.",
        "Maintain a valid enrolment at SKYLINE INSTITUTE OF TECHNOLOGY and inform SKYLINE INSTITUTE OF TECHNOLOGY if you change your student status.",
        "Advise SKYLINE INSTITUTE OF TECHNOLOGY within seven days if you change your address in Australia.",
        "Have enough money to cover tuition fees and living expenses while in Australia.",
        "Not work more than 48 hours during a fortnight (see below).",
        "Maintain valid Overseas Student Health Cover – OSHC (see below).",
        "Not transfer between registered education providers within the first 6 months of your course commencement at SKYLINE INSTITUTE OF TECHNOLOGY – See Transfer of Provider Policy",
      ],
    },
    {
      type: "paragraphs",
      paragraphs: ["For more information about visa conditions and regulations, visit immi.gov.au/students."],
    },
    {
      type: "paragraphs",
      heading: "DO I NEED HEALTH COVER?",
      paragraphs: [
        "Australian student visa requirements include a condition that you must maintain Overseas Student Health Cover (OSHC) while in Australia. You must obtain this cover for the duration of your visa. If you have an accident or health problem within Australia, you will be able to redeem some or all of your medical costs.",
        "SKYLINE INSTITUTE OF TECHNOLOGY can organise OSHC on your behalf. Further details will be provided in your Letter of Offer. For more information, Contact us.",
      ],
    },
    {
      type: "paragraphs",
      heading: "HOW LONG IS MY VISA VALID?",
      paragraphs: [
        "With your Letter of Offer, you will receive an Acceptance of Offer form. Your student visa will be issued for the duration of your course at SKYLINE INSTITUTE OF TECHNOLOGY, as stated in the CoE that you will receive from us.",
      ],
    },
    {
      type: "paragraphs",
      heading: "HOW DO I RENEW MY VISA?",
      paragraphs: [
        "It is your responsibility to renew or extend your visa as required, before it expires. You must present specific documents when applying for an extension or renewal.",
        "If you are currently studying in Australia and require an extension, student visa extensions need to be applied for before your current visa expires. You can apply if you have not completed your course or you’re planning on studying further. SKYLINE INSTITUTE OF TECHNOLOGY has student support team to guide and refer to our education agents to help you with your application.",
      ],
    },
    {
      type: "paragraphs",
      heading: "CAN I WORK IN AUSTRALIA WHILE ON A STUDENT VISA?",
      paragraphs: [
        "If you are an international student currently enrolled and attending classes, you may work up to 48 hours per fortnight while your course is in session, and full-time hours during scheduled course breaks.",
        "Please be aware that your primary purpose in Australia while on a student visa is to study, and that any work you undertake must not interfere with your studies.",
      ],
    },
    {
      type: "paragraphs",
      heading: "WHAT IF I HAVE DEPENDANTS?",
      paragraphs: [
        "If you are a prospective international student and you have any school-aged dependants coming to Australia with you, you must pay full fees for each dependant to be enrolled in a government or non-government school.",
        "The provision of education to international students is regulated by the Department of Education, Department of Immigration and Border Protection (DIBP), through the Education Services for Overseas Students (ESOS) legislative framework.",
      ],
    },
  ],
};

export const oshcPage: ContentPageData = {
  slug: "oshc",
  breadcrumb: "OSHC",
  title: "OSHC",
  blocks: [
    {
      type: "paragraphs",
      heading: "OVERSEAS STUDENT HEALTH COVER",
      paragraphs: [
        "All International Students are required by law to have Overseas Student Health Cover (OSHC) prior to VISA approval. Students are to obtain this cover prior to entry into Australia and are to be covered from the day they arrive until the end of the issued VISA.",
        "As a condition of the student VISA, the Australian Government requires the student to have Overseas Student Health Cover.",
      ],
    },
    {
      type: "list",
      items: [
        "Skyline Institute of Technology is able to provide OSHC through KONPARE which allows students to compare the OSHC providers along with prices and find a suitable plan, Please follow the link https://slit.konpare.online/, or",
        "The students are free to arrange OSHC themselves.",
      ],
    },
    { type: "list", items: ["Students will not be able to obtain a valid Student VISA, if they do not have proof of OSHC"] },
    {
      type: "links",
      items: [{ label: "Compare OSHC providers with KONPARE", href: "https://slit.konpare.online/", external: true }],
    },
    {
      type: "paragraphs",
      heading: "SKYLINE INSTITUTE OF TECHNOLOGY CAN ARRANGE OSHC IF REQUESTED BY THE STUDENT",
      paragraphs: [
        "As part of the Application for Enrolment students are required to indicate whether they require SKYLINE INSTITUTE OF TECHNOLOGY to provide OSHC.",
        "If SKYLINE INSTITUTE OF TECHNOLOGY is to arrange cover, the associated fees will be listed on the Letter of Offer and must be paid at the time of acceptance.",
        "Failure to pay the required fee may affect the Confirmation of Enrolment provided by SKYLINE INSTITUTE OF TECHNOLOGY as well as your Student VISA application.",
        "Please refer to the price schedule. These fees are only payable to SKYLINE INSTITUTE OF TECHNOLOGY for students who choose SKYLINE INSTITUTE OF TECHNOLOGY`s recommended insurance provider.",
        "Students who enrol in a course of duration 10 months or less will need to purchase OSHC for an additional month after the end of the course. For example,",
      ],
    },
    {
      type: "list",
      items: [
        "If you enrol in a 6 months course, you need to purchase 7 months of OSHC.",
        "Students who enrol in a course of duration 11 months or longer will need to purchase OSHC for 2 additional months after the end of the course.",
        "For example, if you enrol in a 12 months course, you need to purchase 14 months of OSHC. The information contained in this publication is correct as of 1st Sep 2023.",
      ],
    },
    {
      type: "paragraphs",
      paragraphs: [
        "Please note that prices change every Calendar year by the OSHC provider. Any variances are payable by the student, on receipt of an invoice from the OSHC provider.",
      ],
    },
  ],
};

export const formsPoliciesPage: ContentPageData = {
  slug: "forms-policies",
  breadcrumb: "Forms & Policies",
  title: "Forms & Policies",
  blocks: [
    {
      type: "links",
      heading: "Forms",
      items: [
        { label: "Student Handbook", href: "https://slit.edu.au/wp-content/uploads/2025/02/P07_Student-Handbook-3.pdf", external: true },
        { label: "Agent Application Form", href: "https://slit.edu.au/wp-content/uploads/2024/11/F04_AGENT-APPLICATION-FORM.pdf", external: true },
        { label: "Application for Credit Transfer", href: "https://slit.edu.au/wp-content/uploads/2024/11/F21_Application-for-credit-transfer-Editable.pdf", external: true },
        { label: "Application for Enrolment", href: "https://slit.edu.au/wp-content/uploads/2024/11/F14_APPLICATION_FOR_ENROLMENT-.pdf", external: true },
        { label: "Critical Incident Action Form", href: "https://slit.edu.au/wp-content/uploads/2024/11/F18_Critical-Incident-Action-Form-Editable.pdf", external: true },
        { label: "Fees Refund Form", href: "https://slit.edu.au/wp-content/uploads/2024/11/F22_Fee-Refund-Form-Editable.pdf", external: true },
        { label: "Leave of Absense Application Form", href: "https://slit.edu.au/wp-content/uploads/2024/11/F19_Leave-of-Absense-Application-Form-Editable.pdf", external: true },
        { label: "Student Complaints and Appeals Form", href: "https://slit.edu.au/wp-content/uploads/2024/11/Student-Complaints-and-Appeals-Form-Editable.pdf", external: true },
        { label: "Deferment of Enrolment Form", href: "https://slit.edu.au/wp-content/uploads/2024/11/F16_Deferment-of-Enrolment-Form-Editable.pdf", external: true },
        { label: "Student Personal Details Form", href: "https://slit.edu.au/wp-content/uploads/2024/11/F24_Student-Personal-Details-Form-Editable.pdf", external: true },
        { label: "Request for Cancellation of CoE", href: "https://slit.edu.au/wp-content/uploads/2024/11/F20_Request-For-Cancellation-of-COE-Editable.pdf", external: true },
        { label: "Student Orientation Presentation – SLIT", href: "https://slit.edu.au/wp-content/uploads/2024/11/Student-Orientation-Presentation_Skyline-Institute-Of-Technology.pdf", external: true },
        { label: "Document Request Form", href: "https://slit.edu.au/wp-content/uploads/2024/11/Document-Request-Form.pdf", external: true },
        { label: "Request for Re-enrolment Form", href: "https://slit.edu.au/wp-content/uploads/2025/03/F17_Re-enrolment-Forms.pdf", external: true },
        { label: "Request for Extension of CoE Form", href: "https://slit.edu.au/wp-content/uploads/2025/03/F18_Request-for-CoE-Extension-Forms.pdf", external: true },
      ],
    },
    {
      type: "links",
      heading: "Policies",
      items: [
        { label: "Anti-Discrimination & Anti-Bullying Policy & Procedure", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Critical Incident Policy", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Fees Refund Policy & Procedure", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Harassment Incident Policy & Complaint Procedure", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Health & Safety Policy & Procedure", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Plagiarism & Academic Misconduct Policy", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Reassessment Policy & Procedure", href: "https://slit.edu.au/under-maintenance/" },
        { label: "RPL & Credit Transfer Policy & Procedure", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Student Complait & Appeal Policy", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Student Support & Welfare Policy", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Course Progress Policy & Procedure", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Transfer between Providers Policy & Procedure", href: "https://slit.edu.au/under-maintenance/" },
        { label: "Deferment Suspension & Cancellation Policy & Procedure", href: "https://slit.edu.au/under-maintenance/" },
      ],
    },
  ],
};

export const registeredAgentsPage: ContentPageData = {
  slug: "agents",
  breadcrumb: "Agents",
  title: "Registered Agents",
  blocks: [
    {
      type: "table",
      columns: ["NAME", "EMAIL", "CONTACT", "ADDRESS"],
      rows: [
        ["AGGARWAL IMMIGRATION CONSULTANTS", "infoaggarwal3@gmail.com", "0433 582 001", "Regus Office, L21/567 Collins St, Melbourne, VIC 3000"],
        ["ASIA PACIFIC GROUP", "vikas@asiapacificgroup.com", "03 7003 8216", "Level 7, 278 Collins St, Melbourne, VIC 3000"],
        ["AUSSIZZ GROUP-BRISBANE", "brisbane@aussizzgroup.com", "07 3221 1981", "Suite 1, L13, 116 Adelaide St, Brisbane, QLD 4000"],
        ["AUSSIZZ GROUP-CANBERRA", "canberra@aussizzgroup.com", "02 6223 2162", "L1/53-55 Northbourne Ave, Canberra City, ACT 2601"],
        ["AUSSIZZ GROUP-CLAYTON", "clayton@aussizzgroup.com", "0414 042 039", "282 B, Clayton Rd, Clayton, VIC 3168"],
        ["AUSSIZZ GROUP-COLLINS ST", "mel@aussizzgroup.com", "03 9602 3435", "L1/Block Ct, 288-290 Collins St, Melbourne, VIC 3000"],
        ["AUSSIZZ GROUP-CRANBOURNE", "cranbourne@aussizzgroup.com", "03 9900 7269", "96 High St, Cranbourne, VIC 3977"],
        ["AUSSIZZ GROUP-DANDENONG", "dandenong@aussizzgroup.com", "03 9900 7271", "244, Lonsdale St, Dandenong, VIC 3175"],
        ["AUSSIZZ GROUP-ELIZABETH ST", "elizabeth@aussizzgroup.com", "03 9900 7234", "L1/7-9 Elizabeth St, Melbourne, VIC 3000"],
        ["AUSSIZZ GROUP-FOOTSCRAY", "footscray@aussizzgroup.com", "0493 686 199", "127 Hopkins St, Footscray, VIC 3011"],
        ["AUSSIZZ GROUP-GEELONG", "geelong@aussizzgroup.com", "03 9900 7237", "221 Moorabool St, Geelong, VIC 3220"],
        ["AUSSIZZ GROUP-GLENROY", "glenroy@aussizzgroup.com", "0493 687 207", "812 Pascoe Vale Rd, Glenroy, VIC 3046"],
        ["AUSSIZZ GROUP-ADELAIDE", "adelaide@aussizzgroup.com", "08 8221 5264", "L3/86 Gawler Place, Adelaide, SA 5000"],
        ["AUSSIZZ GROUP-PAKENHAM", "pakenham@aussizzgroup.com", "0499 388 643", "51 John St, Pakenham, VIC 3810"],
        ["AUSSIZZ GROUP-PERTH", "perth@aussizzgroup.com", "0413 706 491", "L9/231 Adelaide Tce, Perth, WA 6000"],
        ["AUSSIZZ GROUP-SYDNEY", "sydney@aussizzgroup.com", "02 9152 8585", "Suite 2, L1/350 Kent St, Sydney, NSW 2000"],
        ["AUSSIZZ GROUP-THOMASTOWN", "thomastown@aussizzgroup.com", "03 9900 7274", "L1/211 High St, Thomastown, VIC 3074"],
        ["AUSSIZZ GROUP-TRUGANINA", "truganina@aussizzgroup.com", "03 9900 7236", "L2/203 Palmers Rd, Truganina, VIC 3029"],
        ["AUSSIZZ GROUP-WERRIBEE", "werribee@aussizzgroup.com", "03 9900 7235", "Shop 4/1-13, Watton St, Werribee, VIC 3030"],
        ["BANSAL EDUCATION GROUP", "info@bansaleducation.com.au", "0456 000 518", "1 Bald Hill Rd, Pakenham, VIC 3810"],
        ["EPA GLOBAL", "info@epaglobal.com", "0488 048 870", "L1/76 Emu Bank, Belconnen, ACT 2617"],
        ["GAMBA MIGRATION", "students@gamba.com.au", "0431 282 785", "L2/696 Bourke St, Melbourne, VIC 3000"],
        ["GRACE MIGRATION & EDUCATION SERVICES", "admin@gracegroup.com.au", "03 9670 0017", "Suite 1.11 L1/343 Little Collins St, Melbourne, VIC 3000"],
        ["HARI FAMILY TRUST", "ranbir10@gmail.com", "0433 854 481", "Aintree, VIC 3336"],
        ["JAG’S MIGRATION (JAGDISH PATEL)", "info@jagsmigration.com", "0466 147 174", "16 Poplar Blvd, Tarneit, VIC 3029"],
        ["KNOWBAL EDUCATION", "info@knowbal.com.au", "03 9448 1800", "308/111 Overton Rd, Williams Landing, VIC 3027"],
        ["MAHI EDUCATION SERVICES", "admission@mahivisaservices.com", "0497 896 152", "Suite 811/9 Yarra St, South Yarra, VIC 3141"],
        ["BLISS STAR EDUCATION CONSULTANCY", "bilssstareducation@gmail.com", "0414 677 044", "27 Glodeneye Cct, Werribee, VIC 3030"],
        ["OPTIMISTIC CONSULTANTS", "info@optimisticconsultants.com.au", "0426 898 123", "5 Central Grove, Broadmeadows, VIC 3047"],
        ["OZWISE EDUCATION SERVICES", "info@ozwise.au", "0402 019 810", "29 Holmwood Ave, Strathfield South, NSW 2136"],
        ["PSM GLOBAL CONSULTANT", "info@psmglobal.com.au", "0470 586 262", "Suite 7, L5/342-346 Flinders St, Melbourne, VIC 3000"],
        ["RS GLOBAL IMMIGRATION", "info@rsgi.com.au", "0452 299 777", "41 Wuchatsh Ave, Epping, VIC 3076"],
        ["NEWEDUCATION WORLD (AMIT MALIK)", "info@neweducationworld.com.au", "0483 819 493", "31 Glade Ave, Altona North, VIC 3025"],
        ["NEW PAGE INTERNATIONAL", "accounts@newpage.com", "0403 584 012", "Suite 114&113, 365 Little Collins St, Melbourne, VIC 3000"],
        ["SANGUINE MIGRATION", "enq.melb@sanguinemigration.com", "0426 955 000", "525 Collins St, Rialto Towers, West Podium, Mezzanine 2, Melbourne, VIC 3000"],
        ["STUDENT GUIDE AUSTRALIA", "saad@studentguideaustralia.com.au", "0432 461 052", "58 Mt Alexander Rd, Travancore, VIC 3032"],
        ["TILSAV MIGRATION & EDUCATION", "manu@tilsav.com.au", "0452 270 171", "21 Junonia Way, Wyndham Vale, VIC 3024"],
        ["WALES OVERSEAS CONSULTANTS", "info@walesoverseas.com", "0406 127 099", "Suite 305, L3/125 Swanston St, Melbourne, VIC 3000"],
      ],
    },
  ],
};

export const contentPages: Record<string, ContentPageData> = {
  "about-us": aboutPage,
  information: informationPage,
  "student-visa": studentVisaPage,
  oshc: oshcPage,
  "forms-policies": formsPoliciesPage,
  agents: registeredAgentsPage,
};