# FlavorMind Admin Panel
> A web-based moderation dashboard for reviewing FlavorMind recipes, cookbooks, ingredient swaps, and admin account activity.

---

## 1. What I Have Done
This section outlines the work completed for this assignment/project.

* **Feature Implementation:** Developed an admin panel for dashboard counts, pending submissions, moderation history, and admin profile management.
* **Database Integration:** Connected Firebase Authentication and Firestore to load recipes, cookbooks, ingredient substitutions, users, and moderation records.
* **API Development:** Used Firebase client APIs to read and update moderation data directly from Firestore.
* **UI/UX Design:** Built a responsive Vite React admin interface using TypeScript and Tailwind CSS.
* **Logic & Algorithms:** Implemented admin-only access checks using the Firebase `admin` custom claim and moderation status workflows.

## 2. Key Features
- Firebase admin login.
- Dashboard counts for recipes, cookbooks, and ingredient swaps.
- Approve/reject workflow for submitted recipes and cookbooks.
- Ingredient substitution moderation.
- Moderation history view.
- Admin profile, email, and password update screens.

## 3. Tech Stack
- **Language:** TypeScript, JavaScript
- **Framework:** React 19, Vite, Tailwind CSS
- **Database:** Firebase Authentication, Cloud Firestore
- **Other Tools:** npm, ESLint, Firebase client SDK

## 4. Project Structure

```text
FlavorMindAdmin/
├── src/                 # Source code
│   ├── assets/          # Images
│   ├── App.tsx          # Main app
│   ├── config.ts        # Configuration
│   ├── firebase.ts      # Firebase setup
│   ├── index.css        # Styles
│   └── main.tsx         # App entry
├── public/              # Static files
├── .env.example         # Environment sample
├── package.json         # Dependencies
├── vite.config.ts       # Vite config
└── tsconfig.json        # TypeScript config
```

## 5. How To Run

### Step 1: Prerequisites
- Node.js 18 or newer
- npm 9 or newer
- Firebase project with Authentication and Firestore enabled
- Firebase user account with the `admin` custom claim

### Step 2: Installation

```bash
cd D:\DegreeFinal\FlavorMindAdmin
npm install
```

### Step 3: Setup Environment

```bash
cd D:\DegreeFinal\FlavorMindAdmin
copy .env.example .env
```

Set:

```text
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

The signed-in Firebase user must have:

```json
{ "admin": true }
```

### Step 4: Run the Application

```bash
cd D:\DegreeFinal\FlavorMindAdmin
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```text
http://localhost:5173
```

## 6. Testing

```bash
cd D:\DegreeFinal\FlavorMindAdmin
npm run typecheck
npm run build
```

## 7. Contact / Authors
Name: Your Name  
Student ID: Your Student ID  
Email: Your Email
