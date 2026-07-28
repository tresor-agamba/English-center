(() => {
  'use strict';
  const translations = {
    en: {
      'nav.home': 'Home', 'nav.courses': 'Courses', 'nav.about': 'About', 'nav.contact': 'Contact',
      'nav.login': 'Login', 'nav.register': 'Register', 'nav.open': 'Open menu', 'nav.close': 'Close menu',
      'hero.eyebrow': 'Live online language learning', 'hero.title': 'Master Languages. Unlock Opportunities.',
      'hero.copy': 'Learn online with live classes, expert teachers and flexible programs designed for your personal and professional success.',
      'hero.primary': 'Start Learning Today', 'hero.secondary': 'Explore Courses',
      'trust.live': 'Live Online Classes', 'trust.teachers': 'Qualified Teachers', 'trust.flexible': 'Flexible Schedules', 'trust.anywhere': 'Learn from Anywhere',
      'benefits.eyebrow': 'Built for real progress', 'benefits.title': 'A learning experience you can trust',
      'benefits.online': '100% online learning', 'benefits.interactive': 'Live interactive classes', 'benefits.schedule': 'Flexible learning schedule',
      'benefits.speaking': 'Practical speaking approach', 'benefits.support': 'Professional support',
      'why.eyebrow': 'Why choose GLI', 'why.title': 'Everything you need to move forward',
      'why.live.title': 'Live classes', 'why.live.copy': 'Learn in real time and ask questions as you progress.',
      'why.people.title': 'Real teacher interaction', 'why.people.copy': 'Receive guidance and practical feedback from qualified teachers.',
      'why.speak.title': 'Conversation practice', 'why.speak.copy': 'Build confidence through useful, real-world speaking activities.',
      'why.flex.title': 'Flexible schedules', 'why.flex.copy': 'Choose programs designed to fit around your commitments.',
      'why.progress.title': 'Progress tracking', 'why.progress.copy': 'Follow your learning journey from your student dashboard.',
      'why.goals.title': 'Personal and professional goals', 'why.goals.copy': 'Programs designed for individuals and professionals.',
      'why.test.title': 'Placement test', 'why.test.copy': 'Start at the level that best supports your progress.',
      'why.devices.title': 'Learn on any device', 'why.devices.copy': 'Connect from your phone, tablet or computer.',
      'courses.eyebrow': 'Our programs', 'courses.title': 'Find the course that fits your goals',
      'courses.copy': 'Explore currently published programs and choose your next step.',
      'courses.view': 'View course', 'courses.register': 'Register', 'courses.all': 'Explore all courses',
      'courses.empty.title': 'No courses are currently available.', 'courses.empty.copy': 'New programs will be published soon.',
      'detail.back': 'All courses', 'detail.level': 'Level', 'detail.duration': 'Duration', 'detail.mode': 'Format',
      'detail.online': '100% online', 'detail.price': 'Indicative price', 'detail.about': 'About this course',
      'detail.objectives': 'Objectives', 'detail.audience': 'Who it is for', 'detail.prerequisites': 'Prerequisites',
      'detail.calendar': 'Schedule', 'detail.sessions': 'Upcoming sessions', 'detail.empty': 'No sessions scheduled',
      'detail.emptyCopy': 'New dates will be published soon.', 'detail.open': 'Registration open', 'detail.closed': 'Registration closed',
      'detail.start': 'Start', 'detail.end': 'End', 'detail.seats': 'Seats', 'detail.days': 'Days', 'detail.hours': 'Hours',
      'detail.timezone': 'Time zone', 'detail.platform': 'Platform', 'detail.account': 'Already have an account? Sign in',
      'how.eyebrow': 'Simple from day one', 'how.title': 'How it works',
      'how.1': 'Create your account.', 'how.2': 'Choose your course and level.', 'how.3': 'Take the placement test if required.', 'how.4': 'Start learning online.',
      'online.eyebrow': 'Learning without borders', 'online.title': 'Your classroom, wherever you are',
      'online.copy': 'Avoid travel, learn on a flexible schedule and join live classes from the device that works for you.',
      'audience.eyebrow': 'Programs for ambitious learners', 'audience.title': 'Designed for your next opportunity',
      'audience.list': 'Students · Professionals · Company employees · Banking teams · Entrepreneurs · Job seekers · Travellers · Certification candidates',
      'expect.eyebrow': 'What learners can expect', 'expect.title': 'Practical learning, clear guidance and consistent support',
      'expect.copy': 'Every program is designed to help learners participate, practise and progress with confidence.',
      'cta.title': 'Ready to start your language journey?', 'cta.copy': 'Create your student account and begin learning online today.', 'cta.button': 'Create My Account',
      'footer.copy': 'Live online language programs for personal and professional growth.', 'footer.quick': 'Quick links',
      'footer.legal': 'Legal', 'footer.privacy': 'Privacy', 'footer.terms': 'Terms',
      'form.title': 'Create your student account', 'form.copy': 'Choose your program and requested level. Your phone number will be your login.',
      'form.course': 'Course', 'form.course.placeholder': 'Select a course', 'form.name': 'Full name', 'form.phone': 'Phone number',
      'form.phone.help': 'This number will be used to sign in.', 'form.email': 'Email address', 'form.optional': '(optional)',
      'form.level': 'Requested level', 'form.password': 'Password', 'form.confirm': 'Confirm password',
      'form.password.help': 'Use at least 8 characters. Passwords are never displayed again.',
      'form.level1': 'No placement test is required.', 'form.level2': 'A placement test is required before admission to Level 2.',
      'form.level3': 'A placement test is required before admission to Level 3.',
      'form.create': 'Create My Account', 'form.createTest': 'Create My Account and Take the Test',
      'login.title': 'Welcome back', 'login.copy': 'Sign in with your phone number and password.', 'login.phone': 'Phone number',
      'login.password': 'Password', 'login.button': 'Sign In', 'login.new': 'New to GLI?', 'login.create': 'Create your student account',
      'test.eyebrow': 'Placement assessment', 'test.title': 'Your placement test', 'test.copy': 'Answer every question. Your result will help us recommend the most suitable level.',
      'test.submit': 'Submit My Test', 'result.eyebrow': 'Assessment complete', 'result.score': 'Score', 'result.requested': 'Requested level',
      'result.recommended': 'Recommended level', 'result.approved': 'Approved level', 'result.next': 'Go to My Dashboard',
    },
    fr: {
      'nav.home': 'Accueil', 'nav.courses': 'Formations', 'nav.about': 'À propos', 'nav.contact': 'Contact',
      'nav.login': 'Connexion', 'nav.register': 'S’inscrire', 'nav.open': 'Ouvrir le menu', 'nav.close': 'Fermer le menu',
      'hero.eyebrow': 'Apprentissage des langues en direct', 'hero.title': 'Maîtrisez les langues. Ouvrez de nouvelles opportunités.',
      'hero.copy': 'Apprenez en ligne avec des cours en direct, des enseignants qualifiés et des programmes flexibles adaptés à votre réussite personnelle et professionnelle.',
      'hero.primary': 'Commencer maintenant', 'hero.secondary': 'Découvrir les formations',
      'trust.live': 'Cours en direct', 'trust.teachers': 'Enseignants qualifiés', 'trust.flexible': 'Horaires flexibles', 'trust.anywhere': 'Apprenez partout',
      'benefits.eyebrow': 'Conçu pour progresser', 'benefits.title': 'Une expérience d’apprentissage fiable',
      'benefits.online': 'Apprentissage 100 % en ligne', 'benefits.interactive': 'Cours interactifs en direct', 'benefits.schedule': 'Horaires flexibles',
      'benefits.speaking': 'Approche pratique de l’oral', 'benefits.support': 'Accompagnement professionnel',
      'why.eyebrow': 'Pourquoi choisir GLI', 'why.title': 'Tout ce qu’il faut pour avancer',
      'why.live.title': 'Cours en direct', 'why.live.copy': 'Apprenez en temps réel et posez vos questions pendant votre progression.',
      'why.people.title': 'Interaction avec les enseignants', 'why.people.copy': 'Recevez des conseils et retours pratiques d’enseignants qualifiés.',
      'why.speak.title': 'Pratique de la conversation', 'why.speak.copy': 'Développez votre confiance avec des activités orales concrètes.',
      'why.flex.title': 'Horaires flexibles', 'why.flex.copy': 'Choisissez des programmes compatibles avec vos engagements.',
      'why.progress.title': 'Suivi de progression', 'why.progress.copy': 'Suivez votre parcours depuis votre tableau de bord étudiant.',
      'why.goals.title': 'Objectifs personnels et professionnels', 'why.goals.copy': 'Des programmes pour particuliers et professionnels.',
      'why.test.title': 'Test de niveau', 'why.test.copy': 'Commencez au niveau le plus adapté à votre progression.',
      'why.devices.title': 'Tous vos appareils', 'why.devices.copy': 'Connectez-vous depuis téléphone, tablette ou ordinateur.',
      'courses.eyebrow': 'Nos programmes', 'courses.title': 'Trouvez la formation adaptée à vos objectifs',
      'courses.copy': 'Découvrez les programmes publiés et choisissez votre prochaine étape.',
      'courses.view': 'Voir la formation', 'courses.register': 'S’inscrire', 'courses.all': 'Voir toutes les formations',
      'courses.empty.title': 'Aucune formation disponible actuellement.', 'courses.empty.copy': 'De nouveaux programmes seront bientôt publiés.',
      'detail.back': 'Toutes les formations', 'detail.level': 'Niveau', 'detail.duration': 'Durée', 'detail.mode': 'Mode',
      'detail.online': 'Formation 100 % en ligne', 'detail.price': 'Prix indicatif', 'detail.about': 'À propos de la formation',
      'detail.objectives': 'Objectifs', 'detail.audience': 'Public cible', 'detail.prerequisites': 'Prérequis',
      'detail.calendar': 'Calendrier', 'detail.sessions': 'Prochaines sessions', 'detail.empty': 'Aucune session programmée',
      'detail.emptyCopy': 'De nouvelles dates seront publiées prochainement.', 'detail.open': 'Inscriptions ouvertes', 'detail.closed': 'Inscriptions closes',
      'detail.start': 'Début', 'detail.end': 'Fin', 'detail.seats': 'Places', 'detail.days': 'Jours', 'detail.hours': 'Horaires',
      'detail.timezone': 'Fuseau horaire', 'detail.platform': 'Plateforme', 'detail.account': 'Déjà un compte ? Se connecter',
      'how.eyebrow': 'Simple dès le départ', 'how.title': 'Comment ça marche',
      'how.1': 'Créez votre compte.', 'how.2': 'Choisissez votre formation et votre niveau.', 'how.3': 'Passez le test de niveau si nécessaire.', 'how.4': 'Commencez votre apprentissage en ligne.',
      'online.eyebrow': 'Apprendre sans frontières', 'online.title': 'Votre salle de classe, où que vous soyez',
      'online.copy': 'Évitez les déplacements, profitez d’horaires flexibles et rejoignez les cours en direct depuis votre appareil.',
      'audience.eyebrow': 'Pour les apprenants ambitieux', 'audience.title': 'Conçu pour votre prochaine opportunité',
      'audience.list': 'Étudiants · Professionnels · Employés · Équipes bancaires · Entrepreneurs · Demandeurs d’emploi · Voyageurs · Candidats aux certifications',
      'expect.eyebrow': 'Ce que vous pouvez attendre', 'expect.title': 'Pratique, conseils clairs et accompagnement régulier',
      'expect.copy': 'Chaque programme aide les apprenants à participer, pratiquer et progresser avec confiance.',
      'cta.title': 'Prêt à commencer votre apprentissage des langues ?', 'cta.copy': 'Créez votre compte étudiant et commencez votre formation en ligne dès aujourd’hui.', 'cta.button': 'Créer mon compte',
      'footer.copy': 'Des programmes de langues en ligne pour votre développement personnel et professionnel.', 'footer.quick': 'Liens rapides',
      'footer.legal': 'Informations légales', 'footer.privacy': 'Confidentialité', 'footer.terms': 'Conditions',
      'form.title': 'Créez votre compte étudiant', 'form.copy': 'Choisissez votre formation et votre niveau. Votre téléphone sera votre identifiant.',
      'form.course': 'Formation', 'form.course.placeholder': 'Sélectionnez une formation', 'form.name': 'Nom complet', 'form.phone': 'Numéro de téléphone',
      'form.phone.help': 'Ce numéro sera utilisé pour vous connecter.', 'form.email': 'Adresse email', 'form.optional': '(facultative)',
      'form.level': 'Niveau demandé', 'form.password': 'Mot de passe', 'form.confirm': 'Confirmation du mot de passe',
      'form.password.help': 'Utilisez au moins 8 caractères. Les mots de passe ne sont jamais réaffichés.',
      'form.level1': 'Aucun test de niveau obligatoire.', 'form.level2': 'Un test est obligatoire avant votre admission au Level 2.',
      'form.level3': 'Un test est obligatoire avant votre admission au Level 3.',
      'form.create': 'Créer mon compte', 'form.createTest': 'Créer mon compte et passer le test',
      'login.title': 'Heureux de vous revoir', 'login.copy': 'Connectez-vous avec votre téléphone et votre mot de passe.', 'login.phone': 'Numéro de téléphone',
      'login.password': 'Mot de passe', 'login.button': 'Se connecter', 'login.new': 'Nouveau chez GLI ?', 'login.create': 'Créer votre compte étudiant',
      'test.eyebrow': 'Évaluation de placement', 'test.title': 'Votre test de niveau', 'test.copy': 'Répondez à chaque question. Votre résultat permettra de recommander le niveau le plus adapté.',
      'test.submit': 'Valider mon test', 'result.eyebrow': 'Évaluation terminée', 'result.score': 'Score', 'result.requested': 'Niveau demandé',
      'result.recommended': 'Niveau recommandé', 'result.approved': 'Niveau approuvé', 'result.next': 'Accéder à mon tableau de bord',
    },
  };

  const applyLanguage = (language) => {
    const lang = translations[language] ? language : 'en';
    document.documentElement.lang = lang;
    document.documentElement.dataset.language = lang;
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const value = translations[lang][node.dataset.i18n];
      if (value) node.textContent = value;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
      const value = translations[lang][node.dataset.i18nAria];
      if (value) node.setAttribute('aria-label', value);
    });
    const publicErrors = {
      'Numéro de téléphone ou mot de passe incorrect.': 'Phone number or password is incorrect.',
      'Tous les champs sont obligatoires.': 'All required fields must be completed.',
      'Les mots de passe ne correspondent pas.': 'Passwords do not match.',
      'Le mot de passe doit contenir au moins 8 caractères.': 'The password must contain at least 8 characters.',
      'Un compte existe déjà avec ce numéro de téléphone.': 'An account already exists with this phone number.',
    };
    document.querySelectorAll('[data-public-error]').forEach((node) => {
      if (!node.dataset.originalError) node.dataset.originalError = node.textContent.trim();
      node.textContent = lang === 'en' ? (publicErrors[node.dataset.originalError] || node.dataset.originalError) : node.dataset.originalError;
    });
    document.querySelectorAll('[data-language]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.language === lang));
    });
    localStorage.setItem('gli-language', lang);
    document.dispatchEvent(new CustomEvent('gli:languagechange', { detail: { language: lang } }));
  };
  window.GLI_I18N = { applyLanguage, translations, get language() { return document.documentElement.dataset.language || 'en'; } };
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-language]').forEach((button) => button.addEventListener('click', () => applyLanguage(button.dataset.language)));
    applyLanguage(localStorage.getItem('gli-language') || 'en');
  });
})();
