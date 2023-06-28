import { expect } from "chai";
import { Signer, constants } from "ethers"
import { run } from "hardhat";
import { describe } from "mocha";
import {
    BusinessCard,
    BusinessCard__factory,
    CardMarketplace,
    CardMarketplace__factory,
} from "../typechain-types";
import { 
    MIN_LISTING_PRICE,
    MINT_PRICE,
    ORACLE_FEE,
    UPDATE_PRICE
} from "./utils/constants";

describe("CardMarketplace smart contract", () => {
    let businessCard: BusinessCard;
    let cardMarketplace: CardMarketplace;

    let signers: Signer[];
    let accounts: string[];
    let minter: string;
    let buyer: string;

    // Example cardName and cardProperties
    const cardProperties = {
        position: 'Vice President',
        twitterAccount: 'twitterAccount',
        telegramAccount: 'telegramAccount',
        githubAccount: 'githubAccount',
        website: 'website.com'
    }
    
    const firstToken = {
        cardName: 'Patrick BATEMAN',
        cardProperties
    };
    
    const secondToken = {
        cardName: 'Paul ALLEN',
        cardProperties
    };
    
    const thirdToken = {
        cardName: 'David VAN PATTEN',
        cardProperties
    };

    // URI parameters
    const baseUri = 'https://gateway.pinata.cloud/ipfs/Qm';
    const defaultUri = 'bFp3rybuvZ7j9e4xB6WLedu8gvLcjbVqUrGUEugQWz9u';

    // Filler values, would be dynamically generated by the server oracle
    const cardURI = 'Ur63bgQq3VWW9XsVviDGAFwYEZVs9AFWsTd56T9xCQmf'

    before(async () => {
        signers = await run("accounts")
        accounts = await Promise.all(signers.map((signer: Signer) => signer.getAddress()))
    })

    beforeEach(async () => {
        minter = accounts[1]
        buyer = accounts[2]

        const { businessCardAddress, dctAddress, cardMarketplaceAddress } = await run("deploy:business-card", { 
            baseUri,
            defaultUri,
            oracleAddress: accounts[9]
        })

        businessCard = BusinessCard__factory.connect(businessCardAddress, signers[1])
        cardMarketplace = CardMarketplace__factory.connect(cardMarketplaceAddress, signers[1])
    })

    describe("createCardListing", () => {
        beforeEach(async () => {
            await cardMarketplace.connect(signers[0]).pauseMarketplace()
        })

        context("when the marketplace is not active", () => {
            it("reverts", async () => {
                await expect(
                    cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "MarketplaceIsPaused"
                )
            })
        })

        context("when the marketplace is active", () => {
            beforeEach(async () => {
                await cardMarketplace.connect(signers[0]).startMarketplace()
                await businessCard.getCard(firstToken.cardName, firstToken.cardProperties, { value: MINT_PRICE })
            })

            context("when the listing price is below the minimum", () => {
                it("reverts", async () => {
                    await businessCard.approve(cardMarketplace.address, 1)

                    await expect(
                        cardMarketplace.createCardListing(1, MIN_LISTING_PRICE.sub(1))
                    ).to.be.revertedWithCustomError(
                        cardMarketplace,
                        "PriceTooLow"
                    )
                })
            })

            context("when the card to be listed does not exist", () => {
                it("reverts", async () => {
                    await expect(
                        cardMarketplace.createCardListing(2, MIN_LISTING_PRICE)
                    ).to.be.revertedWith(
                        "ERC721: invalid token ID"
                    )
                })
            })

            context("when the card to be listed has not been approved for spending", () => {
                it("reverts", async () => {                    
                    await expect(
                        cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)
                    ).to.be.revertedWith(
                        "ERC721: caller is not token owner or approved"
                    )
                })
            })

            context("when the msg.sender does not own the card", () => {
                it("reverts", async () => {
                    await businessCard.approve(cardMarketplace.address, 1)

                    await expect(
                        cardMarketplace.connect(signers[2]).createCardListing(1, MIN_LISTING_PRICE)
                    ).to.be.revertedWith(
                        "ERC721: transfer from incorrect owner"
                    )
                })
            })

            context("after a successful listing", () => {
                let tx: any;

                beforeEach(async () => {
                    await businessCard.approve(cardMarketplace.address, 1)

                    tx = await cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)
                })

                it("increases the number of listings", async () => {
                    expect(await cardMarketplace.totalListings())
                        .to.be.equal(1)
                })

                it("creates the corresponding listing", async () => {
                    expect((await cardMarketplace.getLatestListingByCard(1)).slice(0,6))
                        .to.deep.equal([1, minter, constants.AddressZero, MIN_LISTING_PRICE, false, false])
                })

                it("transfers the token to the marketplace", async () => {
                    expect(await businessCard.ownerOf(1))
                        .to.be.equal(cardMarketplace.address)
                })

                it("emits a CardListingCreated", async () => {
                    await expect(tx)
                        .to.emit(cardMarketplace, "CardListingCreated")
                        .withArgs(1, 1, minter, MIN_LISTING_PRICE)
                })
            })
        })
    })

    describe("cancelCardListing", () => {
        beforeEach(async () => {
            await businessCard.getCard(firstToken.cardName, firstToken.cardProperties, { value: MINT_PRICE })

            await businessCard.approve(cardMarketplace.address, 1)

            await cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)
        })

        context("when the market listing was filled", () => {
            it("reverts", async () => {
                await cardMarketplace.connect(signers[2]).buyListedCard(1, { value: MIN_LISTING_PRICE })
            
                await expect(
                    cardMarketplace.cancelCardListing(1)
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "ListingWasFilled"
                )
            })
        })

        context("when the market listing was already cancelled", () => {
            it("reverts", async () => {
                await cardMarketplace.cancelCardListing(1)
            
                await expect(
                    cardMarketplace.cancelCardListing(1)
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "ListingWasCancelled"
                )
            })
        })

        context("when the market listing does not exist", () => {
            it("reverts", async () => {
                await expect(
                    cardMarketplace.cancelCardListing(2)
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "ListingDoesNotExist"
                )
            })
        })

        context("when the msg.sender is not the listing creator", () => {
            it("reverts", async () => {
                await expect(
                    cardMarketplace.connect(signers[2]).cancelCardListing(1)
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "CallerIsNotTheSeller"
                )
            })
        })

        context("after a successful call", () => {
            let tx: any;

            beforeEach(async () => {
                tx = await cardMarketplace.cancelCardListing(1)
            })

            it("updates the corresponding listing", async () => {
                expect((await cardMarketplace.getLatestListingByCard(1)).slice(0,6))
                    .to.deep.equal([1, minter, minter, MIN_LISTING_PRICE, false, true])
            })

            it("increases the number of cancelled listings", async () => {
                expect(await cardMarketplace.cancelledListings())
                    .to.be.equal(1)
            })

            it("transfers the Business Card back to its original owner", async () => {
                expect(await businessCard.ownerOf(1))
                    .to.be.equal(minter)
            })

            it("emits a CardListingCancelled event", async () => {
                await expect(tx)
                    .to.emit(cardMarketplace, "CardListingCancelled")
                    .withArgs(1, 1)
            })
        })
    })

    describe("buyListedCard", () => {
        beforeEach(async () => {
            await businessCard.getCard(firstToken.cardName, firstToken.cardProperties, { value: MINT_PRICE })

            await businessCard.approve(cardMarketplace.address, 1)

            await cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)
        })

        context("when the market listing was already filled", () => {
            it("reverts", async () => {
                await cardMarketplace.connect(signers[2]).buyListedCard(1, { value: MIN_LISTING_PRICE })

                await expect(
                    cardMarketplace.connect(signers[2]).buyListedCard(1, { value: MIN_LISTING_PRICE })
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "ListingWasFilled"
                )
            })
        })

        context("when the market listing was cancelled", () => {
            it("reverts", async () => {
                await cardMarketplace.cancelCardListing(1)

                await expect(
                    cardMarketplace.connect(signers[2]).buyListedCard(1, { value: MIN_LISTING_PRICE })
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "ListingWasCancelled"
                )
            })
        })

        context("when the market listing does not exist", () => {
            it("reverts", async () => {
                await expect(
                    cardMarketplace.connect(signers[2]).buyListedCard(2, { value: MIN_LISTING_PRICE })
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "ListingDoesNotExist"
                )
            })
        })

        context("when the marketplace is paused", () => {
            it("reverts", async () => {
                await cardMarketplace.connect(signers[0]).pauseMarketplace()

                await expect(
                    cardMarketplace.connect(signers[2]).buyListedCard(1, { value: MIN_LISTING_PRICE })
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "MarketplaceIsPaused"
                )
            })
        })

        context("when the value sent is below the listing price", () => {
            it("reverts", async () => {
                await expect(
                    cardMarketplace.connect(signers[2]).buyListedCard(1, { value: MIN_LISTING_PRICE.sub(1) })
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "PriceTooLow"
                )
            })
        })

        context("after a successful call", () => {
            let tx: any;

            beforeEach(async () => {
                tx = await cardMarketplace.connect(signers[2]).buyListedCard(1, { value: MIN_LISTING_PRICE })
            })

            it("updates the corresponding listing", async () => {
                expect((await cardMarketplace.getLatestListingByCard(1)).slice(0,6))
                    .to.deep.equal([1, minter, buyer, MIN_LISTING_PRICE, true, false])
            })

            it("increases the number of filled listings", async () => {
                expect(await cardMarketplace.filledListings())
                    .to.be.equal(1)
            })

            it("sends the price to the seller", async () => {
                expect(tx).to.changeEtherBalance(minter, MIN_LISTING_PRICE)
            })

            it("transfers the Business Card to the buyer", async () => {
                expect(await businessCard.ownerOf(1))
                    .to.be.equal(buyer)
            })

            it("emits a CardListingFilled event", async () => {
                await expect(tx)
                    .to.emit(cardMarketplace, "CardListingFilled")
                    .withArgs(1, 1, minter, buyer, MIN_LISTING_PRICE)
            })
        })
    })

    describe("buyAndUpdateListedCard", () => {
        const FULL_PRICE = MIN_LISTING_PRICE.add(UPDATE_PRICE).add(ORACLE_FEE)

        beforeEach(async () => {
            await businessCard.getCard(firstToken.cardName, firstToken.cardProperties, { value: MINT_PRICE })
            await businessCard.connect(signers[9]).updateCallback(1, cardURI)

            await businessCard.approve(cardMarketplace.address, 1)

            await cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)
        })

        context("when the market listing was already filled", () => {
            it("reverts", async () => {
                await cardMarketplace.connect(signers[2]).buyAndUpdateListedCard(
                    1, secondToken.cardName, secondToken.cardProperties, { value: FULL_PRICE }
                )

                await expect(
                    cardMarketplace.connect(signers[2]).buyAndUpdateListedCard(
                        1, secondToken.cardName, secondToken.cardProperties, { value: FULL_PRICE }
                    )
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "ListingWasFilled"
                )
            })
        })

        context("when the market listing was cancelled", () => {
            it("reverts", async () => {
                await cardMarketplace.cancelCardListing(1)

                await expect(
                    cardMarketplace.connect(signers[2]).buyAndUpdateListedCard(
                        1, secondToken.cardName, secondToken.cardProperties, { value: FULL_PRICE }
                    )
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "ListingWasCancelled"
                )
            })
        })

        context("when the market listing does not exist", () => {
            it("reverts", async () => {
                await expect(
                    cardMarketplace.connect(signers[2]).buyAndUpdateListedCard(
                        2, secondToken.cardName, secondToken.cardProperties, { value: FULL_PRICE }
                    )
                ).to.be.revertedWith(
                    "ERC721: invalid token ID"
                )
            })
        })

        context("when the marketplace is paused", () => {
            it("reverts", async () => {
                await cardMarketplace.connect(signers[0]).pauseMarketplace()

                await expect(
                    cardMarketplace.connect(signers[2]).buyAndUpdateListedCard(
                        1, secondToken.cardName, secondToken.cardProperties, { value: FULL_PRICE }
                    )
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "MarketplaceIsPaused"
                )
            })
        })

        context("when the value sent does not cover all the costs", () => {
            it("reverts", async () => {
                await expect(
                    cardMarketplace.connect(signers[2]).buyAndUpdateListedCard(
                        1, secondToken.cardName, secondToken.cardProperties, { value: FULL_PRICE.sub(1) }
                    )
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "PriceTooLow"
                )
            })
        })

        context("after a successful call", () => {
            let tx: any;

            beforeEach(async () => {
                tx = await cardMarketplace.connect(signers[2]).buyAndUpdateListedCard(
                    1, secondToken.cardName, secondToken.cardProperties, { value: FULL_PRICE }
                )
            })

            it("updates the corresponding listing", async () => {
                expect((await cardMarketplace.getLatestListingByCard(1)).slice(0,6))
                    .to.deep.equal([1, minter, buyer, MIN_LISTING_PRICE, true, false])
            })

            it("increases the number of filled listings", async () => {
                expect(await cardMarketplace.filledListings())
                    .to.be.equal(1)
            })

            it("sends the price to the seller", async () => {
                expect(tx).to.changeEtherBalance(minter, MIN_LISTING_PRICE)
            })

            it("transfers the Business Card to the buyer", async () => {
                expect(await businessCard.ownerOf(1))
                    .to.be.equal(buyer)
            })

            it("emits a CardListingFilled event", async () => {
                await expect(tx)
                    .to.emit(cardMarketplace, "CardListingFilled")
                    .withArgs(1, 1, minter, buyer, MIN_LISTING_PRICE)
            })

            it("updates the Business Card", async () => {
                expect(await businessCard.isNameReserved(firstToken.cardName.toLowerCase()))
                        .to.be.equal(false)

                expect(await businessCard.isNameReserved(secondToken.cardName.toLowerCase()))
                    .to.be.equal(true)
            })
        })
    })

    describe("getMarketListings", () => {
        beforeEach(async () => {
            await businessCard.getCard(firstToken.cardName, firstToken.cardProperties, { value: MINT_PRICE })
            await businessCard.getCard(secondToken.cardName, secondToken.cardProperties, { value: MINT_PRICE })
            await businessCard.getCard(thirdToken.cardName, thirdToken.cardProperties, { value: MINT_PRICE })
            await businessCard.getCard("SNEED", thirdToken.cardProperties, { value: MINT_PRICE })

            await businessCard.approve(cardMarketplace.address, 1)
            await businessCard.approve(cardMarketplace.address, 2)
            await businessCard.approve(cardMarketplace.address, 3)
            await businessCard.approve(cardMarketplace.address, 4)

            await cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)
            await cardMarketplace.createCardListing(2, MIN_LISTING_PRICE)
            await cardMarketplace.createCardListing(3, MIN_LISTING_PRICE)
            await cardMarketplace.createCardListing(4, MIN_LISTING_PRICE)

            await cardMarketplace.cancelCardListing(2)
            await cardMarketplace.connect(signers[2]).buyListedCard(3, { value: MIN_LISTING_PRICE })
        })

        it("returns a list of active listings", async () => {
            expect(await cardMarketplace.getMarketListings())
                .to.deep.equal([
                    [1, minter, constants.AddressZero, MIN_LISTING_PRICE, false, false],
                    [4, minter, constants.AddressZero, MIN_LISTING_PRICE, false, false]
                ])
        })
    })
    
    describe("getMarketListingsByAddress", () => {
        beforeEach(async () => {
            // SELLER 
            await businessCard.getCard(firstToken.cardName, firstToken.cardProperties, { value: MINT_PRICE })
            await businessCard.approve(cardMarketplace.address, 1)
            await cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)

            await businessCard.getCard(secondToken.cardName, secondToken.cardProperties, { value: MINT_PRICE })
            await businessCard.approve(cardMarketplace.address, 2)
            await cardMarketplace.createCardListing(2, MIN_LISTING_PRICE)

            // BUYER
            await businessCard.getCard(thirdToken.cardName, thirdToken.cardProperties, { value: MINT_PRICE })
            await businessCard.approve(cardMarketplace.address, 3)
            await cardMarketplace.createCardListing(3, MIN_LISTING_PRICE)

            await cardMarketplace.connect(signers[2]).buyListedCard(3, { value: MIN_LISTING_PRICE })

            await businessCard.getCard("SNEED", firstToken.cardProperties, { value: MINT_PRICE })
            await businessCard.approve(cardMarketplace.address, 4)
            await cardMarketplace.createCardListing(4, MIN_LISTING_PRICE)

            await cardMarketplace.connect(signers[2]).buyListedCard(4, { value: MIN_LISTING_PRICE })
        })

        it("returns the latest listings for an address as a seller", async () => {
            expect((await cardMarketplace.getMarketListingsByAddress(minter, true)).slice(0,6))
                .to.deep.equal([
                    [1, minter, constants.AddressZero, MIN_LISTING_PRICE, false, false],
                    [2, minter, constants.AddressZero, MIN_LISTING_PRICE, false, false],
                    [3, minter, buyer, MIN_LISTING_PRICE, true, false],
                    [4, minter, buyer, MIN_LISTING_PRICE, true, false]
                ])
        })

        it("returns the latest listing for an address as a buyer", async () => {
            expect((await cardMarketplace.getMarketListingsByAddress(buyer, false)).slice(0,6))
                .to.deep.equal([
                    [3, minter, buyer, MIN_LISTING_PRICE, true, false],
                    [4, minter, buyer, MIN_LISTING_PRICE, true, false]
                ])
        })
    })

    describe("getLatestListingByCard", () => {
        beforeEach(async () => {
            // Listed-cancelled-listed card
            await businessCard.getCard(firstToken.cardName, firstToken.cardProperties, { value: MINT_PRICE })
            await businessCard.approve(cardMarketplace.address, 1)

            await cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)
            await cardMarketplace.cancelCardListing(1)
            
            await businessCard.approve(cardMarketplace.address, 1)
            await cardMarketplace.createCardListing(1, MIN_LISTING_PRICE.add(1))

            // Listed-bought-listed card
            await businessCard.getCard(secondToken.cardName, secondToken.cardProperties, { value: MINT_PRICE })
            await businessCard.approve(cardMarketplace.address, 2)

            await cardMarketplace.createCardListing(2, MIN_LISTING_PRICE)
            await cardMarketplace.connect(signers[2]).buyListedCard(3, { value: MIN_LISTING_PRICE })
            
            await businessCard.connect(signers[2]).approve(cardMarketplace.address, 2)
            await cardMarketplace.connect(signers[2]).createCardListing(2, MIN_LISTING_PRICE)
        })

        it("returns the latest listing in the marketplace for a Business Card", async () => {
            expect(await cardMarketplace.getLatestListingByCard(1))
                .to.deep.equal([1, minter, constants.AddressZero, MIN_LISTING_PRICE.add(1), false, false])
                
            expect(await cardMarketplace.getLatestListingByCard(2))
                .to.deep.equal([2, buyer, constants.AddressZero, MIN_LISTING_PRICE, false, false])
        })
    })

    describe("startMarketplace", () => {
        beforeEach(async () => {
            await cardMarketplace.connect(signers[0]).pauseMarketplace()
        })

        context("when being called by someone other than the contract owner", () => {
            it("reverts", async () => {
                await expect(
                    cardMarketplace.startMarketplace()
                ).to.be.revertedWith(
                    "Ownable: caller is not the owner"
                )
            })
        })

        context("after a successful call", () => {
            beforeEach(async () => {
                await cardMarketplace.connect(signers[0]).startMarketplace()
            })

            it("permits the listing and buying of Business Cards", async () => {
                await businessCard.getCard(firstToken.cardName, firstToken.cardProperties, { value: MINT_PRICE })
                await businessCard.approve(cardMarketplace.address, 1)

                await cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)

                await cardMarketplace.connect(signers[2]).buyListedCard(1, { value: MIN_LISTING_PRICE })
            })
        })
    })

    describe("pauseMarketplace", () => {
        context("when being called by someone other than the contract owner", () => {
            it("reverts", async () => {
                await expect(
                    cardMarketplace.pauseMarketplace()
                ).to.be.revertedWith(
                    "Ownable: caller is not the owner"
                )
            })
        })

        context("after a successful call", () => {
            beforeEach(async () => {
                await businessCard.getCard(firstToken.cardName, firstToken.cardProperties, { value: MINT_PRICE })
                await businessCard.approve(cardMarketplace.address, 1)

                await businessCard.getCard(secondToken.cardName, secondToken.cardProperties, { value: MINT_PRICE })
                await businessCard.approve(cardMarketplace.address, 2)
                await cardMarketplace.createCardListing(2, MIN_LISTING_PRICE)

                await cardMarketplace.connect(signers[0]).pauseMarketplace()
            })

            it("does not permit the listing and buying of Business Cards", async () => {

                await expect(
                    cardMarketplace.createCardListing(1, MIN_LISTING_PRICE)
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "MarketplaceIsPaused"
                )

                await expect (
                    cardMarketplace.connect(signers[2]).buyListedCard(1, { value: MIN_LISTING_PRICE })
                ).to.be.revertedWithCustomError(
                    cardMarketplace,
                    "MarketplaceIsPaused"
                )
            })
        })
    })
})