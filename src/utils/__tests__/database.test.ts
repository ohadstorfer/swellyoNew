import { databaseService, User } from '../../services/database/databaseService';

// Mock expo-sqlite
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(() => Promise.resolve({
    execAsync: jest.fn(() => Promise.resolve()),
    runAsync: jest.fn(() => Promise.resolve({ lastInsertRowId: 1, changes: 1 })),
    getFirstAsync: jest.fn(() => Promise.resolve({
      id: 1,
      email: 'test@example.com',
      nickname: 'Test User',
      googleId: 'google123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    })),
    getAllAsync: jest.fn(() => Promise.resolve([]))
  }))
}));

describe('DatabaseService', () => {
  beforeEach(async () => {
    await databaseService.init();
  });

  it('should save a user', async () => {
    const userData = {
      email: 'test@example.com',
      nickname: 'Test User',
      googleId: 'google123'
    };

    const user = await databaseService.saveUser(userData);
    
    expect(user).toBeDefined();
    expect(user.email).toBe(userData.email);
    expect(user.nickname).toBe(userData.nickname);
    expect(user.googleId).toBe(userData.googleId);
  });

  it('should get user by Google ID', async () => {
    const user = await databaseService.getUserByGoogleId('google123');
    
    expect(user).toBeDefined();
    expect(user?.googleId).toBe('google123');
  });

  it('should get user by email', async () => {
    const user = await databaseService.getUserByEmail('test@example.com');
    
    expect(user).toBeDefined();
    expect(user?.email).toBe('test@example.com');
  });
});
