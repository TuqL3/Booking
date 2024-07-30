import express, { Request, Response } from 'express';
import Hotel from '../models/hotel';
import { BookingType, HotelSearchResponse } from '../shared/types';
import { param, validationResult } from 'express-validator';
// import Stripe from 'stripe';
import verifyToken from '../middleware/auth';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import moment from 'moment';
import qs from 'qs';

type IConfig = {
  app_id: any;
  key1: any;
  key2: any;
  endpoint: any;
};

const config: IConfig = {
  app_id: '2553',
  key1: 'PcY4iZIKFCIdgZvA6ueMcMHHUbRLYjPL',
  key2: 'kLtgPl8HHhfvMuDHPwKfgfsY4Ydm9eIz',
  endpoint: 'https://sb-openapi.zalopay.vn/v2/create',
};

// const stripe = new Stripe(process.env.STRIPE_API_KEY as string);

const router = express.Router();

router.get('/search', async (req: Request, res: Response) => {
  try {
    const query = constructSearchQuery(req.query);

    let sortOptions = {};
    switch (req.query.sortOption) {
      case 'starRating':
        sortOptions = { starRating: -1 };
        break;
      case 'pricePerNightAsc':
        sortOptions = { pricePerNight: 1 };
        break;
      case 'pricePerNightDesc':
        sortOptions = { pricePerNight: -1 };
        break;
    }

    const pageSize = 5;
    const pageNumber = parseInt(
      req.query.page ? req.query.page.toString() : '1',
    );
    const skip = (pageNumber - 1) * pageSize;

    const hotels = await Hotel.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(pageSize);

    const total = await Hotel.countDocuments(query);

    const response: HotelSearchResponse = {
      data: hotels,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / pageSize),
      },
    };

    res.json(response);
  } catch (error) {
    console.log('error', error);
    res.status(500).json({ message: 'Something went wrong' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const hotels = await Hotel.find().sort('-lastUpdated');
    res.json(hotels);
  } catch (error) {
    console.log('error', error);
    res.status(500).json({ message: 'Error fetching hotels' });
  }
});

router.get(
  '/:id',
  [param('id').notEmpty().withMessage('Hotel ID is required')],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const id = req.params.id.toString();

    try {
      const hotel = await Hotel.findById(id);
      res.json(hotel);
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: 'Error fetching hotel' });
    }
  },
);

router.post(
  // '/:hotelId/bookings/payment-intent',
  '/:hotelId/payment',
  async (req: Request, res: Response) => {
    const hotelId = req.params.hotelId;
    const numberOfNights = req.body.numberOfNights;
    // console.log(req.params.hotelId);'
    // console.log(req.userId);

    // console.log(req.body);
    const hotel = await Hotel.findById(hotelId);
    if (!hotel) {
      return res.status(400).json({ message: 'Hotel not found' });
    }

    const totalCost = hotel.pricePerNight * numberOfNights;
    const embed_data = {
      redirecturl: "http://localhost:5174",
      firstName: req.body.formData.firstName,
      lastName: req.body.formData.lastName,
      email: req.body.formData.email,
      adultCount: req.body.formData.adultCount,
      childCount: req.body.formData.childCount,
      checkIn: req.body.formData.checkIn,
      checkOut: req.body.formData.checkOut,
      totalCost: totalCost,
      userId: req.body.currentUser._id,
    };

    const items = [
      {
        item_id: hotel._id,
        item_name: hotel.name,
        item_price: hotel.pricePerNight,
        item_quantity: numberOfNights,
      },
    ];
    const transID = Math.floor(Math.random() * 1000000);
    const order: any = {
      app_id: config.app_id,
      app_trans_id: `${moment().format('YYMMDD')}_${transID}`, // translation missing: vi.docs.shared.sample_code.comments.app_trans_id
      app_user: 'user123',
      app_time: Date.now(), // miliseconds
      item: JSON.stringify(items),
      embed_data: JSON.stringify(embed_data),
      amount: totalCost,
      description: `Booking - Payment for the order #${transID}`,
      bank_code: '',
      callback_url:
        'https://d9f2-2402-800-6172-2840-348f-f9e9-925f-ffb2.ngrok-free.app',
    };

    // appid|app_trans_id|appuser|amount|apptime|embeddata|item
    const data =
      config.app_id +
      '|' +
      order.app_trans_id +
      '|' +
      order.app_user +
      '|' +
      order.amount +
      '|' +
      order.app_time +
      '|' +
      order.embed_data +
      '|' +
      order.item;
    order.mac = CryptoJS.HmacSHA256(data, config.key1).toString();

    try {
      const result = await axios.post(config.endpoint, null, { params: order });
      // console.log("result.data: ",result.data);
      return res.status(200).json(result.data)
    } catch (error) {
      console.log(error);
    }
  },
);

router.post('/callback', async (req, res) => {
  let result: any = {};

  try {
    let dataStr = req.body.data;
    let reqMac = req.body.mac;

    let mac = CryptoJS.HmacSHA256(dataStr, config.key2).toString();
    // console.log('mac =', mac);

    // kiểm tra callback hợp lệ (đến từ ZaloPay server)
    if (reqMac !== mac) {
      // callback không hợp lệ
      result.return_code = -1;
      result.return_message = 'mac not equal';
    } else {
      // thanh toán thành công
      // merchant cập nhật trạng thái cho đơn hàng
      let dataJson = JSON.parse(dataStr, config.key2);
      // console.log(dataJson);
      // const { hotelId, numberOfNights, firstName, lastName, email, adultCount, childCount, checkIn, checkOut, userId, totalCost } = JSON.parse(dataJson.embed_data);

      // Save booking details to the database

      const newBooking = JSON.parse(dataJson.embed_data);
      // console.log(newBooking);
      const items = JSON.parse(dataJson.item);
      const itemId = items[0].item_id;
      

      // const hotel1 = await Hotel.findById({_id: itemId})

      // console.log(hotel1);
      

      const hotel = await Hotel.findOneAndUpdate(
        { _id: itemId },
        {
          $push: { bookings: newBooking },
        },
      );

      await hotel?.save();

      console.log(
        "update order's status = success where app_trans_id =",
        dataJson['app_trans_id'],
      );

      result.return_code = 1;
      result.return_message = 'success';
    }
  } catch (ex: any) {
    result.return_code = 0; // ZaloPay server sẽ callback lại (tối đa 3 lần)
    result.return_message = ex.message;
  }

  // thông báo kết quả cho ZaloPay server
  res.json(result);
});

const constructSearchQuery = (queryParams: any) => {
  let constructedQuery: any = {};

  if (queryParams.destination) {
    constructedQuery.$or = [
      { city: new RegExp(queryParams.destination, 'i') },
      { country: new RegExp(queryParams.destination, 'i') },
    ];
  }

  if (queryParams.adultCount) {
    constructedQuery.adultCount = {
      $gte: parseInt(queryParams.adultCount),
    };
  }

  if (queryParams.childCount) {
    constructedQuery.childCount = {
      $gte: parseInt(queryParams.childCount),
    };
  }

  if (queryParams.facilities) {
    constructedQuery.facilities = {
      $all: Array.isArray(queryParams.facilities)
        ? queryParams.facilities
        : [queryParams.facilities],
    };
  }

  if (queryParams.types) {
    constructedQuery.type = {
      $in: Array.isArray(queryParams.types)
        ? queryParams.types
        : [queryParams.types],
    };
  }

  if (queryParams.stars) {
    const starRatings = Array.isArray(queryParams.stars)
      ? queryParams.stars.map((star: string) => parseInt(star))
      : parseInt(queryParams.stars);

    constructedQuery.starRating = { $in: starRatings };
  }

  if (queryParams.maxPrice) {
    constructedQuery.pricePerNight = {
      $lte: parseInt(queryParams.maxPrice).toString(),
    };
  }

  return constructedQuery;
};

router.post('/order-status/:app_trans_id', async (req, res) => {
  const app_trans_id = req.params.app_trans_id;
  let postData: any = {
    app_id: config.app_id,
    app_trans_id: app_trans_id, // Input your app_trans_id
  };

  let data = postData.app_id + '|' + postData.app_trans_id + '|' + config.key1; // appid|app_trans_id|key1
  postData.mac = CryptoJS.HmacSHA256(data, config.key1).toString();

  let postConfig = {
    method: 'post',
    url: 'https://sb-openapi.zalopay.vn/v2/query',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: qs.stringify(postData),
  };

  try {
    const resutl = await axios(postConfig);
    console.log(JSON.stringify(resutl.data));
  } catch (error) {
    console.log(error);
  }
});

export default router;
