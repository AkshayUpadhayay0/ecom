import type { RequestHandler } from 'express';
import {
  assignMediaSchema,
  changeProductStatusSchema,
  createClothingTypeSchema,
  createGarmentCutSchema,
  createProductSchema,
  createSizeSchema,
  listClothingTypesQuerySchema,
  listGarmentCutsQuerySchema,
  listProductsQuerySchema,
  listSizesQuerySchema,
  reorderSizesSchema,
  updateClothingTypeSchema,
  updateGarmentCutSchema,
  updateProductSchema,
  updateSizeSchema,
} from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { uuidParam } from '../../lib/params.js';
import { bodyOf, sendData, sendPage } from '../../lib/respond.js';
import { auditActorOf } from '../audit/audit-actor.js';
import type { ClothingTypesService } from './clothing-types.service.js';
import type { GarmentCutsService } from './garment-cuts.service.js';
import type { ProductsService } from './products.service.js';
import type { SizesService } from './sizes.service.js';

export interface CatalogController {
  listClothingTypes: RequestHandler;
  getClothingType: RequestHandler;
  createClothingType: RequestHandler;
  updateClothingType: RequestHandler;
  listSizes: RequestHandler;
  getSize: RequestHandler;
  createSize: RequestHandler;
  updateSize: RequestHandler;
  reorderSizes: RequestHandler;
  listGarmentCuts: RequestHandler;
  getGarmentCut: RequestHandler;
  createGarmentCut: RequestHandler;
  updateGarmentCut: RequestHandler;
  listProducts: RequestHandler;
  getProduct: RequestHandler;
  createProduct: RequestHandler;
  updateProduct: RequestHandler;
  changeProductStatus: RequestHandler;
  setProductVideo: RequestHandler;
}

export interface CatalogServices {
  clothingTypes: ClothingTypesService;
  sizes: SizesService;
  garmentCuts: GarmentCutsService;
  products: ProductsService;
}

export function createCatalogController(services: CatalogServices): CatalogController {
  const { clothingTypes, sizes, garmentCuts, products } = services;
  return {
    // ---------- Clothing types ----------
    listClothingTypes: async (req, res) => {
      sendPage(res, await clothingTypes.list(listClothingTypesQuerySchema.parse(req.query)));
    },
    getClothingType: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await clothingTypes.get(uuidParam(req)));
    },
    createClothingType: async (req, res) => {
      const input = createClothingTypeSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await clothingTypes.create(auditActorOf(req), input));
    },
    updateClothingType: async (req, res) => {
      const id = uuidParam(req);
      const input = updateClothingTypeSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await clothingTypes.update(auditActorOf(req), id, input));
    },

    // ---------- Sizes ----------
    listSizes: async (req, res) => {
      sendPage(res, await sizes.list(listSizesQuerySchema.parse(req.query)));
    },
    getSize: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await sizes.get(uuidParam(req)));
    },
    createSize: async (req, res) => {
      const input = createSizeSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await sizes.create(auditActorOf(req), input));
    },
    updateSize: async (req, res) => {
      const id = uuidParam(req);
      const input = updateSizeSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await sizes.update(auditActorOf(req), id, input));
    },
    reorderSizes: async (req, res) => {
      const { ids } = reorderSizesSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await sizes.reorder(auditActorOf(req), ids));
    },

    // ---------- Garment cuts ----------
    listGarmentCuts: async (req, res) => {
      sendPage(res, await garmentCuts.list(listGarmentCutsQuerySchema.parse(req.query)));
    },
    getGarmentCut: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await garmentCuts.get(uuidParam(req)));
    },
    createGarmentCut: async (req, res) => {
      const input = createGarmentCutSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await garmentCuts.create(auditActorOf(req), input));
    },
    updateGarmentCut: async (req, res) => {
      const id = uuidParam(req);
      const input = updateGarmentCutSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await garmentCuts.update(auditActorOf(req), id, input));
    },

    // ---------- Products ----------
    listProducts: async (req, res) => {
      sendPage(res, await products.list(listProductsQuerySchema.parse(req.query)));
    },
    getProduct: async (req, res) => {
      sendData(res, HTTP_STATUS.OK, await products.get(uuidParam(req)));
    },
    createProduct: async (req, res) => {
      const input = createProductSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.CREATED, await products.create(auditActorOf(req), input));
    },
    updateProduct: async (req, res) => {
      const id = uuidParam(req);
      const input = updateProductSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await products.update(auditActorOf(req), id, input));
    },
    changeProductStatus: async (req, res) => {
      const id = uuidParam(req);
      const { status } = changeProductStatusSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await products.changeStatus(auditActorOf(req), id, status));
    },
    setProductVideo: async (req, res) => {
      const id = uuidParam(req);
      const { mediaAssetId } = assignMediaSchema.parse(bodyOf(req));
      sendData(res, HTTP_STATUS.OK, await products.setVideo(auditActorOf(req), id, mediaAssetId));
    },
  };
}
