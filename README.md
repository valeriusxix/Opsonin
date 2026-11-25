# Opsonin

**A fleet immune system on QoreChain.** *A stolen key can only stop robots. Only a post-quantum key can bring them back.*

Status: work in progress for the QoreChain "Build Before Q-Day" developer fest (Post-Quantum AI Agents track). Testnet: `qorechain-diana`.

- Spec: [AGENT.md](AGENT.md)
- Verified chain facts: [docs/CHAIN_NOTES.md](docs/CHAIN_NOTES.md)

Addresses, tx hashes, the demo URL and the video will be added here as they become real. Nothing in this README is a placeholder hash.

## Honest limits
1. Robots are **simulated**. No physical hardware in the demo.
2. The worm is **author-modelled**, inspired by public reports (Unitree credential flaws, BLE injection, DDS/ROS 2 unauthenticated topics). It is not a real exploit and we ship no exploit code.
3. On-chain quarantine is **not real-time**. Safety comes from cached epochs and fail-safe defaults.
4. Testnet only. Not audited beyond QCAI. No production-safety claim.
5. "Agent leash" is a crowded category. Our difference is the **restrict-only / PQ-release asymmetry applied to physical fleets**.

## License
Apache-2.0. See [LICENSE](LICENSE).
