import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateAirportPoiMetrics } from '../google-poi-sync.server';
vi.mock('~/utils/db.server', () => ({
  createPrisma: vi.fn(() => ({
    airportPoi: {
      update: vi.fn().mockResolvedValue({}),
    },
  })),
}));

const mockPrisma = {
  airportPoi: {
    update: vi.fn().mockResolvedValue({}),
  },
};

describe('updateAirportPoiMetrics performance', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Mock global fetch
    global.fetch = vi.fn().mockImplementation(async (url) => {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
            ok: true,
            json: async () => ({
                rows: [{
                    elements: [{
                        status: 'OK',
                        distance: { value: 1000 },
                        duration: { value: 600 },
                    }]
                }]
            })
        };
    });
  });

  it('measures the time taken for updateAirportPoiMetrics', async () => {
    const start = Date.now();
    await updateAirportPoiMetrics({
      prisma: mockPrisma as any,
      apiKey: 'test-key',
      airportPoiId: 1,
      origin: { latitude: 0, longitude: 0 },
      destination: { latitude: 0.1, longitude: 0.1 },
    });
    const end = Date.now();
    const duration = end - start;
    console.log(`Duration: ${duration}ms`);

    // modes are walking, bicycling, transit, driving
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
