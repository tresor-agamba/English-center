// Deliberately no fetch/network capability. Only these locally created mocks are accepted.
const simulations = new WeakSet();
function createGupshupSimulation(replies = []) {
  const queue = structuredClone(replies);
  const requests = [];
  const simulation = Object.freeze({
    get requests() { return structuredClone(requests); },
    async request(request) {
      requests.push(structuredClone(request));
      const next = queue.shift();
      if (!next || next.failure) throw new Error('Simulated transport unavailable.');
      return structuredClone(next);
    },
  });
  simulations.add(simulation);
  return simulation;
}
module.exports = { createGupshupSimulation, isGupshupSimulation: value => simulations.has(value) };
