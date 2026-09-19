import { providerStubs } from './provider-stubs.js';

// print.error() only prints; throwing is what stops the request.
beforeAll(() => {
  providerStubs.listen({
    onUnhandledRequest: (request, print) => {
      if (new URL(request.url).hostname !== '127.0.0.1') {
        print.error();
        throw new Error(`unhandled request to ${request.url}`);
      }
    },
  });
});

afterEach(() => {
  providerStubs.events.removeAllListeners();
  providerStubs.resetHandlers();
});

afterAll(() => {
  providerStubs.close();
});
