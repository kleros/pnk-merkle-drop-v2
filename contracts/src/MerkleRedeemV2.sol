// SPDX-License-Identifier: MIT

/**
 * Original code taken from: https://github.com/balancer-labs/erc20-
 * redeemable/blob/13d478a043ec7bfce7abefe708d027dfe3e2ea84/merkle/contracts/MerkleRedeem.sol
 *
 * Only comments and events were added, some variable names changed for clarity and the compiler version was upgraded to 0.8.20.
 *
 * @reviewers: [@hbarcelos, @kemuru]
 * @auditors: []
 * @bounties: []
 * @deployments: []
 */

pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Distribution of tokens in a recurrent fashion.
 */
contract MerkleRedeem is Ownable {
    /// @dev The address of the token being distributed.
    IERC20 public token;

    /**
     * @dev Emitted when a claim is made.
     * @param _claimant The address of the claimant.
     * @param _balance The amount being claimed.
     */
    event Claimed(address _claimant, uint256 _balance);

    /// @dev The merkle roots of each month: monthMerkleRoots[month].
    mapping(uint => bytes32) public monthMerkleRoots;

    /// @dev Tracks claim status for a given month and address: claimed[month][account] = true if claimed.
    mapping(uint => mapping(address => bool)) public claimed;

    /**
     * @param _token The address of the token being distributed.
     */
    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }

    /**
     * @dev Internal function to pay out a claim.
     * @param _liquidityProvider The address of the claimant.
     * @param _balance The amount being claimed.
     */
    function disburse(address _liquidityProvider, uint _balance) private {
        if (_balance > 0) {
            emit Claimed(_liquidityProvider, _balance);
            require(token.transfer(_liquidityProvider, _balance), "ERR_TRANSFER_FAILED");
        }
    }

    /**
     * @notice Make a claim for a given month.
     * @param _liquidityProvider The address of the claimant.
     * @param _month The month number for the claim.
     * @param _claimedBalance The amount being claimed for that month.
     * @param _merkleProof The Merkle proof, from leaf to root.
     */
    function claimMonth(
        address _liquidityProvider,
        uint _month,
        uint _claimedBalance,
        bytes32[] memory _merkleProof
    ) public {
        require(!claimed[_month][_liquidityProvider]);
        require(verifyClaim(_liquidityProvider, _month, _claimedBalance, _merkleProof), 'Incorrect merkle proof');

        claimed[_month][_liquidityProvider] = true;
        disburse(_liquidityProvider, _claimedBalance);
    }

    struct Claim {
        // The month number of the claim.
        uint month;
        // The amount being claimed for that month.
        uint balance;
        // The Merkle proof for this claim.
        bytes32[] merkleProof;
    }

    /**
     * @notice Make multiple claims for multiple months in one transaction.
     * @param _liquidityProvider The address of the claimant.
     * @param claims An array of Claim structs (month, balance, proof).
     */
    function claimMonths(address _liquidityProvider, Claim[] memory claims) public {
        uint totalBalance = 0;
        Claim memory claim;
        for (uint i = 0; i < claims.length; i++) {
            claim = claims[i];
            require(!claimed[claim.month][_liquidityProvider]);
            require(verifyClaim(_liquidityProvider, claim.month, claim.balance, claim.merkleProof), 'Incorrect merkle proof');
            totalBalance += claim.balance;
            claimed[claim.month][_liquidityProvider] = true;
        }
        disburse(_liquidityProvider, totalBalance);
    }

    /**
     * @notice Check claim status from month `_begin` to `_end` for a user.
     * @param _liquidityProvider The address of the user/claimant.
     * @param _begin The starting month (inclusive).
     * @param _end The ending month (inclusive).
     * @return An array of booleans indicating claimed (true) or not for each month in range.
     */
    function claimStatus(address _liquidityProvider, uint _begin, uint _end) external view returns (bool[] memory) {
        uint size = 1 + _end - _begin;
        bool[] memory status = new bool[](size);
        for (uint i = 0; i < size; i++) {
            status[i] = claimed[_begin + i][_liquidityProvider];
        }
        return status;
    }

    /**
     * @notice Get Merkle roots for months `_begin` to `_end`.
     * @param _begin The starting month (inclusive).
     * @param _end The ending month (inclusive).
     * @return An array of merkle roots corresponding to each month in the range.
     */
    function merkleRoots(uint _begin, uint _end) external view returns (bytes32[] memory) {
        uint size = 1 + _end - _begin;
        bytes32[] memory roots = new bytes32[](size);
        for (uint i = 0; i < size; i++) {
            roots[i] = monthMerkleRoots[_begin + i];
        }
        return roots;
    }

    /**
     * @notice Verify a claim against the stored Merkle root.
     * @param _liquidityProvider The address of the claimant.
     * @param _month The month number of the claim.
     * @param _claimedBalance The amount being claimed for that month.
     * @param _merkleProof The Merkle proof for this claim.
     * @return valid True if the claim is valid (proof matches the root).
     */
    function verifyClaim(
        address _liquidityProvider,
        uint _month,
        uint _claimedBalance,
        bytes32[] memory _merkleProof
    ) public view returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(_liquidityProvider, _claimedBalance));
        return MerkleProof.verify(_merkleProof, monthMerkleRoots[_month], leaf);
    }

    /**
     * @notice Seed allocations for a new airdrop month.
     * @dev Transfers the total allocation from the owner to this contract.
     * @param _month The month number to seed.
     * @param _merkleRoot The Merkle root of the claims for that month.
     * @param _totalAllocation The total token amount allocated for that month.
     */
    function seedAllocations(uint _month, bytes32 _merkleRoot, uint _totalAllocation) external onlyOwner {
        require(monthMerkleRoots[_month] == bytes32(0), "cannot rewrite merkle root");
        monthMerkleRoots[_month] = _merkleRoot;
        require(token.transferFrom(msg.sender, address(this), _totalAllocation), "ERR_TRANSFER_FAILED");
    }
}