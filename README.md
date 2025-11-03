# SWELLYO - Cross-Platform App

A React Native application built with Expo that supports iOS, Android, and Web platforms from day one.

## 🚀 Features

- **Cross-Platform**: Single codebase for iOS, Android, and Web
- **Modern Design**: Clean, minimalist UI with consistent theming
- **TypeScript**: Full TypeScript support for better development experience
- **Reusable Components**: Modular component architecture with shared styling
- **Responsive Design**: Optimized for all screen sizes and platforms

## 🛠 Tech Stack

- **React Native** - Cross-platform mobile development
- **Expo** - Development platform and tooling
- **TypeScript** - Type-safe JavaScript
- **React Native SVG** - Vector graphics support
- **Expo Linear Gradient** - Gradient backgrounds

## 📱 Screens

### Welcome Screen
- Beautiful gradient background with subtle wave patterns
- Custom logo with gradient and wavy lines
- Responsive call-to-action button
- Login prompt for existing users

## 🎨 Design System

The app uses a consistent design system with:
- **Colors**: Warm, earthy palette with browns and pinks
- **Typography**: Clear hierarchy with consistent font weights and sizes
- **Spacing**: Systematic spacing scale for consistent layouts
- **Components**: Reusable UI components with consistent styling

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Expo CLI (optional, but recommended)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd swellyo
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

### Running on Different Platforms

- **Web**: `npm run web`
- **iOS Simulator**: `npm run ios`
- **Android Emulator**: `npm run android`

## 📁 Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Button.tsx     # Custom button component
│   ├── Logo.tsx       # App logo with SVG
│   ├── Text.tsx       # Typography component
│   └── index.ts       # Component exports
├── screens/            # App screens
│   └── WelcomeScreen.tsx
├── styles/             # Design system and themes
│   └── theme.ts       # Colors, spacing, typography
├── types/              # TypeScript type definitions
├── utils/              # Utility functions
└── assets/             # Images, fonts, etc.
```

## 🔧 Development

### Adding New Components
1. Create the component in `src/components/`
2. Export it from `src/components/index.ts`
3. Use the theme from `src/styles/theme.ts` for consistent styling

### Adding New Screens
1. Create the screen in `src/screens/`
2. Import and use it in `App.tsx` or navigation

### Styling Guidelines
- Use the theme constants for colors, spacing, and typography
- Create reusable components instead of duplicating styles
- Follow the existing component patterns

## 📱 Platform-Specific Considerations

- **Web**: Uses React Native Web for browser compatibility
- **Mobile**: Native performance with platform-specific optimizations
- **Responsive**: Adapts to different screen sizes and orientations

## 🚀 Deployment

### Web
- Build for production: `expo build:web`
- Deploy to any static hosting service

### Mobile
- Build for app stores: `expo build:ios` / `expo build:android`
- Submit to App Store and Google Play Store

## 🤝 Contributing

1. Follow the existing code style and patterns
2. Use TypeScript for all new code
3. Create reusable components when possible
4. Test on all platforms before submitting

## 📄 License

This project is licensed under the MIT License. 