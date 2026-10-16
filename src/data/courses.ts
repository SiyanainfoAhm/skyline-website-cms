export type CourseUnitView = { code: string; name: string; category: string };
export type CourseAttachmentView = { id: string; name: string; url: string };

export type Course = {
  slug: string;
  code?: string;
  cricos?: string;
  name: string;
  category: string;
  image?: string;
  imageAlt: string;
  summary?: string;
  mode?: string;
  duration?: string;
  entry?: string;
  theoryLocation?: string;
  practicalLocation?: string;
  units?: CourseUnitView[];
  attachments?: CourseAttachmentView[];
};

export const courseCategories: string[] = [
  "Automotive",
  "Building & Construction",
  "Civil Construction Design",
  "Furnishing & Glazing",
  "Business & Management",
];

/* Every category used by a course now has a matching filter tag, so each
   filter reliably returns its courses. */
export const visibleCourseCategories: string[] = courseCategories;

export const courses: Course[] = [
  {
    slug: "msf30422-certificate-iii-in-glass-and-glazing",
    code: "MSF30422",
    cricos: "119813H",
    name: "MSF30422 Certificate III in Glass and Glazing",
    category: "Furnishing & Glazing",
    image: "https://slit.edu.au/wp-content/uploads/2026/01/MSF30422_1800x1200.jpg",
    imageAlt: "MSF30422 Certificate III in Glass and Glazing",
    summary:
      "Ideal for students looking to build skills in the glass and glazing industry, covering the processing, handling, transporting and installing of a variety of glass products across both residential and commercial projects.",
    mode: "Face-to-Face",
    duration: "52 Weeks",
    entry: "Over 18 years",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
    practicalLocation: "181-183 Springvale Rd, Springvale VIC 3171",
  },
  {
    slug: "msf30322-certificate-iii-in-cabinet-making-and-timber-technology",
    code: "MSF30322",
    cricos: "119814G",
    name: "MSF30322 Certificate III in Cabinet Making and Timber Technology",
    category: "Furnishing & Glazing",
    image: "https://slit.edu.au/wp-content/uploads/2026/01/MSF30322_1800x1200-1.jpg",
    imageAlt: "MSF30322 Certificate III in Cabinet Making and Timber Technology",
    summary:
      "For students who want to start or build a career in the cabinet making and timber industry, covering the skills to manufacture, assemble, install and repair cabinetry and timber products for residential and commercial projects.",
    mode: "Face-to-Face",
    duration: "52 Weeks",
    entry: "Over 18 years",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
    practicalLocation: "271-273 Macaulay Rd, North Melbourne VIC 3051",
  },
  {
    slug: "cpc50220-diploma-of-building-and-construction-building",
    code: "CPC50220",
    cricos: "119301K",
    name: "CPC50220 Diploma of Building and Construction (Building)",
    category: "Building & Construction",
    image: "https://slit.edu.au/wp-content/uploads/2025/11/Construction.webp",
    imageAlt: "CPC50220 Diploma of Building and Construction (Building)",
    summary:
      "Reflects the role of building professionals who plan, coordinate and oversee residential and commercial construction projects, managing contractors, contracts, budgets and quality while ensuring compliance with safety and building standards.",
    mode: "Face-to-Face",
    duration: "72 Weeks",
    entry: "Over 18 years",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
    practicalLocation: "271-273 Macaulay Rd, North Melbourne VIC 3051",
  },
  {
    slug: "cpc30620-certificate-iii-in-painting-and-decorating",
    code: "CPC30620",
    cricos: "119299K",
    name: "CPC30620 Certificate III in Painting and Decorating",
    category: "Building & Construction",
    image: "https://slit.edu.au/wp-content/uploads/2025/11/Painting.webp",
    imageAlt: "CPC30620 Certificate III in Painting and Decorating",
    summary:
      "Reflects the role of skilled tradespeople who apply specialised knowledge and practical skills in painting and decorating, preparing surfaces, applying paints and coatings, and finishing interior and exterior structures to industry standards.",
    mode: "Face-to-Face",
    duration: "60 Weeks",
    entry: "Over 18 years",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
    practicalLocation: "271-273 Macaulay Rd, North Melbourne VIC 3051",
  },
  {
    slug: "cpc30220-certificate-iii-in-carpentry",
    code: "CPC30220",
    cricos: "119300M",
    name: "CPC30220 Certificate III in Carpentry",
    category: "Building & Construction",
    image: "https://slit.edu.au/wp-content/uploads/2025/11/Carpentry.jpg",
    imageAlt: "CPC30220 Certificate III in Carpentry",
    summary:
      "Reflects the role of skilled tradespeople who plan, construct, assemble, install and repair structures and fixtures using both timber and non-timber materials across residential and commercial projects.",
    mode: "Face-to-Face",
    duration: "60 Weeks",
    entry: "Over 18 years",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
    practicalLocation: "271-273 Macaulay Rd, North Melbourne VIC 3051",
  },
  {
    slug: "rii50520-diploma-of-civil-construction-design",
    code: "RII50520",
    cricos: "118122K",
    name: "RII50520 Diploma of Civil Construction Design",
    category: "Civil Construction Design",
    image: "https://slit.edu.au/wp-content/uploads/2024/05/team-professional-architects_23-2147702469.avif",
    imageAlt: "RII50520 Diploma of Civil Construction Design",
    summary:
      "For individuals who work as engineering designers or design paraprofessionals, providing essential support to professional engineers while planning and selecting appropriate equipment, roles and techniques for their own work and for others.",
    mode: "Face-to-Face",
    duration: "60 Weeks",
    entry: "Over 18 years of age",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
  },
  {
    slug: "rii60520-advanced-diploma-of-civil-construction-design-52weeks",
    code: "RII60520",
    cricos: "115521H",
    name: "RII60520 Advanced Diploma of Civil Construction Design (52 Weeks)",
    category: "Civil Construction Design",
    image: "https://slit.edu.au/wp-content/uploads/2024/05/team-professional-architects_23-2147702469.avif",
    imageAlt: "RII60520 Advanced Diploma of Civil Construction Design (52 Weeks)",
    summary:
      "Reflects the role of a senior civil works designer or para-professional designer who is responsible for the design of complex projects and initiates solutions to technical or management requirements.",
    mode: "Face-to-Face",
    duration: "52 Weeks",
    entry: "Successful completion of RII50520",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
  },
  {
    slug: "rii60520-advanced-diploma-of-civil-construction-design",
    code: "RII60520",
    cricos: "115521H",
    name: "RII60520 Advanced Diploma of Civil Construction Design",
    category: "Civil Construction Design",
    image: "https://slit.edu.au/wp-content/uploads/2024/05/team-professional-architects_23-2147702469.avif",
    imageAlt: "RII60520 Advanced Diploma of Civil Construction Design",
    summary:
      "Reflects the role of a senior civil works designer or para-professional designer supporting professional engineers, applying theoretical and technical knowledge with self-direction and initiating solutions to technical problems.",
    mode: "Face-to-Face",
    duration: "104 Weeks",
    entry: "Over 18 years of age",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
  },
  {
    slug: "certificate-iii-in-light-vehicle-mechanical-technology",
    code: "AUR30620",
    cricos: "112739C",
    name: "AUR30620 Certificate III in Light Vehicle Mechanical Technology",
    category: "Automotive",
    image: "https://slit.edu.au/wp-content/uploads/2023/02/lightvehicle.png",
    imageAlt: "AUR30620 Certificate III in Light Vehicle Mechanical Technology",
    summary:
      "Reflects the role of individuals who perform a broad range of tasks on a variety of light vehicles in the automotive retail, service and repair industry.",
    mode: "Face-to-Face",
    duration: "66 Weeks",
    entry: "Over 18 years",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
    practicalLocation: "51 Brady St, South Melbourne, VIC 3205",
  },
  {
    slug: "certificate-iv-in-automotive-mechanical-diagnosis",
    code: "AUR40216",
    cricos: "112740K",
    name: "AUR40216 Certificate IV in Automotive Mechanical Diagnosis",
    category: "Automotive",
    image: "https://slit.edu.au/wp-content/uploads/2023/03/automotive.png",
    imageAlt: "AUR40216 Certificate IV in Automotive Mechanical Diagnosis",
    summary:
      "Covers the skills and knowledge required to perform advanced diagnostic operations in the automotive retail, service and repair environment.",
    mode: "Face-to-Face",
    duration: "36 Weeks",
    entry: "Over 18 years",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
    practicalLocation: "51 Brady St, South Melbourne, VIC 3205",
  },
  {
    slug: "diploma-of-business",
    code: "BSB50120",
    cricos: "112741J",
    name: "BSB50120 Diploma of Business",
    category: "Business & Management",
    image: "https://slit.edu.au/wp-content/uploads/2023/02/buisness.png",
    imageAlt: "BSB50120 Diploma of Business",
    summary:
      "Reflects the role of individuals in a variety of business services job roles who carry out moderately complex tasks in a specialist field of expertise that requires business operations skills.",
    mode: "Face-to-Face",
    duration: "52 Weeks",
    entry: "Over 18 years",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
  },
  {
    slug: "ict60220-advanced-diploma-of-information-technology",
    code: "ICT60220",
    cricos: "115522G",
    name: "ICT60220 Advanced Diploma of Information Technology",
    category: "Business & Management",
    image:
      "https://slit.edu.au/wp-content/uploads/2024/05/low-angle-medium-shot-teenage-girls-talking_23-2148225325.avif",
    imageAlt: "ICT60220 Advanced Diploma of Information Technology",
    summary:
      "Reflects the role of individuals in a variety of information and communications technology (ICT) roles who have significant experience in specialist technical skills, or managerial business and people management skills.",
    mode: "Face-to-Face",
    duration: "104 Weeks",
    entry: "Over 18 years of age",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
  },
  {
    slug: "bsb80120-graduate-diploma-of-management-learning",
    code: "BSB80120",
    name: "BSB80120 Graduate Diploma of Management (Learning)",
    category: "Business & Management",
    image: "https://slit.edu.au/wp-content/uploads/2023/07/management.jpg",
    imageAlt: "BSB80120 Graduate Diploma of Management (Learning)",
    summary:
      "Reflects the role of individuals who apply highly specialised knowledge and skills in the field of organisational learning and capability development, initiating, designing and executing major learning and development functions.",
    mode: "Face-to-Face",
    duration: "52 Weeks",
    entry: "Over 18 years of age",
    theoryLocation: "L8, 310 King St, Melbourne, VIC 3000",
  },
];

export const courseCount = courses.length;
