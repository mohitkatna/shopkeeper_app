const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";
const JWT_SECRET =
  process.env.JWT_SECRET ||
  "nearkart_super_secret_key_change_this";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:Mma12345678!%3F@localhost:5432/nearkart";

const pool = new Pool({
  connectionString: DATABASE_URL,
});

app.use(
  cors({
    origin: "*",
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

app.use(
  express.json({
    limit: "20mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "20mb",
  })
);

const uploadsDir = path.join(
  __dirname,
  "uploads"
);

const productUploadsDir = path.join(
  uploadsDir,
  "products"
);

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(
    uploadsDir,
    {
      recursive: true,
    }
  );
}

if (!fs.existsSync(productUploadsDir)) {
  fs.mkdirSync(
    productUploadsDir,
    {
      recursive: true,
    }
  );
}

app.use(
  "/uploads",
  express.static(uploadsDir)
);

function normalizeRole(role) {
  if (!role) {
    return "";
  }

  return String(role)
    .trim()
    .toLowerCase();
}

function normalizeStatus(status) {
  if (!status) {
    return "";
  }

  return String(status)
    .trim()
    .toLowerCase();
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: normalizeRole(
        user.role
      ),
    },
    JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
}

function auth(req, res, next) {
  try {
    const header =
      req.headers.authorization ||
      "";

    if (!header) {
      return res.status(401).json({
        error:
          "Authorization token required",
      });
    }

    const parts =
      header.split(" ");

    if (
      parts.length !== 2 ||
      parts[0] !== "Bearer"
    ) {
      return res.status(401).json({
        error:
          "Invalid authorization format",
      });
    }

    const token = parts[1];

    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      error:
        "Invalid or expired token",
    });
  }
}

function roles(...allowedRoles) {
  const normalized =
    allowedRoles.map(
      normalizeRole
    );

  return (
    req,
    res,
    next
  ) => {
    const currentRole =
      normalizeRole(
        req.user &&
          req.user.role
      );

    if (
      !normalized.includes(
        currentRole
      )
    ) {
      return res.status(403).json({
        error:
          "Access denied",
      });
    }

    next();
  };
}

function safeFileName(
  originalName
) {
  const extension =
    path.extname(
      originalName || ""
    ).toLowerCase();

  const random =
    crypto.randomBytes(16)
      .toString("hex");

  return `${Date.now()}_${random}${extension}`;
}

function saveBase64Image(
  imageData,
  productId
) {
  if (
    typeof imageData !==
    "string"
  ) {
    throw new Error(
      "Invalid image data"
    );
  }

  let mimeType =
    "image/jpeg";

  let base64 =
    imageData;

  const match =
    imageData.match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
    );

  if (match) {
    mimeType =
      match[1];

    base64 =
      match[2];
  }

  const extensionMap = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };

  const extension =
    extensionMap[
      mimeType.toLowerCase()
    ] || ".jpg";

  const random =
    crypto.randomBytes(12)
      .toString("hex");

  const fileName =
    `product_${productId}_${Date.now()}_${random}${extension}`;

  const filePath =
    path.join(
      productUploadsDir,
      fileName
    );

  const buffer =
    Buffer.from(
      base64,
      "base64"
    );

  fs.writeFileSync(
    filePath,
    buffer
  );

  return `/uploads/products/${fileName}`;
}

function deleteLocalImage(
  imageUrl
) {
  if (
    !imageUrl ||
    typeof imageUrl !==
      "string"
  ) {
    return;
  }

  try {
    const cleanPath =
      imageUrl.split("?")[0];

    if (
      !cleanPath.startsWith(
        "/uploads/products/"
      )
    ) {
      return;
    }

    const fileName =
      path.basename(
        cleanPath
      );

    const filePath =
      path.join(
        productUploadsDir,
        fileName
      );

    if (
      fs.existsSync(
        filePath
      )
    ) {
      fs.unlinkSync(
        filePath
      );
    }
  } catch (error) {
    console.error(
      "IMAGE DELETE ERROR:",
      error.message
    );
  }
}

function deleteProductImages(
  images
) {
  if (
    !Array.isArray(images)
  ) {
    return;
  }

  for (
    const image of images
  ) {
    deleteLocalImage(
      image
    );
  }
}

async function saveProductImages(
  images,
  productId
) {
  if (
    images === undefined ||
    images === null
  ) {
    return null;
  }

  if (
    !Array.isArray(images)
  ) {
    throw new Error(
      "Images must be an array"
    );
  }

  if (
    images.length > 5
  ) {
    throw new Error(
      "Maximum 5 images allowed"
    );
  }

  const savedImages = [];

  for (
    const image of images
  ) {
    if (
      typeof image !==
      "string"
    ) {
      continue;
    }

    if (
      image.startsWith(
        "/uploads/products/"
      )
    ) {
      savedImages.push(
        image
      );

      continue;
    }

    if (
      image.startsWith(
        "http://"
      ) ||
      image.startsWith(
        "https://"
      )
    ) {
      savedImages.push(
        image
      );

      continue;
    }

    if (
      image.startsWith(
        "data:image/"
      )
    ) {
      const saved =
        saveBase64Image(
          image,
          productId
        );

      savedImages.push(
        saved
      );

      continue;
    }

    throw new Error(
      "Invalid product image format"
    );
  }

  return savedImages;
}

async function getShopForOwner(
  shopId,
  userId
) {
  const result =
    await pool.query(
      `SELECT
         id,
         owner_id,
         name,
         status,
         approved_at
       FROM shops
       WHERE id=$1
         AND owner_id=$2
       LIMIT 1`,
      [
        shopId,
        userId,
      ]
    );

  if (
    !result.rowCount
  ) {
    return null;
  }

  return result.rows[0];
}

async function getApprovedShopForOwner(
  shopId,
  userId
) {
  const shop =
    await getShopForOwner(
      shopId,
      userId
    );

  if (!shop) {
    return {
      shop: null,
      error:
        "Shop not found or you are not the owner",
    };
  }

  if (
    normalizeStatus(
      shop.status
    ) !== "approved"
  ) {
    return {
      shop,
      error:
        "Shop must be approved before managing products",
    };
  }

  return {
    shop,
    error: null,
  };
}

async function verifyGmailTransport() {
  return true;
}

async function sendPushToUser(
  userId,
  title,
  body,
  data = {},
  type = ""
) {
  console.log(
    "Notification:",
    {
      userId,
      title,
      body,
      data,
      type,
    }
  );

  return true;
}

app.get(
  "/",
  (
    req,
    res
  ) => {
    res.json({
      message:
        "NearKart API is running",
      status:
        "ok",
    });
  }
);

app.get(
  "/api/health",
  async (
    req,
    res
  ) => {
    try {
      await pool.query(
        "SELECT 1"
      );

      res.json({
        status:
          "ok",
        database:
          "connected",
      });
    } catch (error) {
      res.status(500).json({
        status:
          "error",
        database:
          "disconnected",
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/auth/register",
  async (
    req,
    res
  ) => {
    try {
      const {
        name,
        email,
        password,
        phone,
        role = "customer",
      } = req.body;

      if (
        !name ||
        !email ||
        !password
      ) {
        return res.status(400).json({
          error:
            "Name, email and password are required",
        });
      }

      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();

      const userRole =
        normalizeRole(
          role
        ) === "shopkeeper"
          ? "shopkeeper"
          : "customer";

      const existing =
        await pool.query(
          `SELECT id
           FROM users
           WHERE LOWER(email)=LOWER($1)
           LIMIT 1`,
          [
            normalizedEmail,
          ]
        );

      if (
        existing.rowCount
      ) {
        return res.status(409).json({
          error:
            "Email already registered",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          10
        );

      const result =
        await pool.query(
          `INSERT INTO users
           (
             name,
             email,
             password,
             phone,
             role
           )
           VALUES
           ($1,$2,$3,$4,$5)
           RETURNING
             id,
             name,
             email,
             phone,
             role,
             created_at`,
          [
            name,
            normalizedEmail,
            passwordHash,
            phone || null,
            userRole,
          ]
        );

      const user =
        result.rows[0];

      const token =
        createToken(user);

      res.status(201).json({
        message:
          "Registration successful",
        token,
        user,
      });
    } catch (error) {
      console.error(
        "REGISTER ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/auth/login",
  async (
    req,
    res
  ) => {
    try {
      const {
        email,
        password,
      } = req.body;

      if (
        !email ||
        !password
      ) {
        return res.status(400).json({
          error:
            "Email and password are required",
        });
      }

      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();

      const result =
        await pool.query(
          `SELECT *
           FROM users
           WHERE LOWER(email)=LOWER($1)
           LIMIT 1`,
          [
            normalizedEmail,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(401).json({
          error:
            "Invalid email or password",
        });
      }

      const user =
        result.rows[0];

      const passwordMatch =
        await bcrypt.compare(
          password,
          user.password
        );

      if (
        !passwordMatch
      ) {
        return res.status(401).json({
          error:
            "Invalid email or password",
        });
      }

      const token =
        createToken(user);

      delete user.password;

      res.json({
        message:
          "Login successful",
        token,
        user,
      });
    } catch (error) {
      console.error(
        "LOGIN ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/auth/me",
  auth,
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,
             name,
             email,
             phone,
             role,
             created_at
           FROM users
           WHERE id=$1
           LIMIT 1`,
          [
            req.user.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/auth/logout",
  auth,
  async (
    req,
    res
  ) => {
    res.json({
      message:
        "Logout successful",
    });
  }
);

app.post(
  "/api/auth/forgot-password",
  async (
    req,
    res
  ) => {
    try {
      const {
        email,
      } = req.body;

      if (!email) {
        return res.status(400).json({
          error:
            "Email is required",
        });
      }

      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();

      const result =
        await pool.query(
          `SELECT id
           FROM users
           WHERE LOWER(email)=LOWER($1)
           LIMIT 1`,
          [
            normalizedEmail,
          ]
        );

      res.json({
        message:
          "If this email exists, password reset instructions will be sent.",
        exists:
          Boolean(
            result.rowCount
          ),
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shops",
  async (
    req,
    res
  ) => {
    try {
      const {
        status,
        search,
      } = req.query;

      const values = [];

      let sql = `
        SELECT
          s.*,
          u.name AS owner_name,
          u.email AS owner_email,
          u.phone AS owner_phone
        FROM shops s
        JOIN users u
          ON u.id=s.owner_id
        WHERE 1=1
      `;

      if (status) {
        values.push(
          status
        );

        sql += `
          AND s.status=$${values.length}
        `;
      }

      if (search) {
        values.push(
          `%${search}%`
        );

        sql += `
          AND (
            s.name ILIKE $${values.length}
            OR s.city ILIKE $${values.length}
            OR u.name ILIKE $${values.length}
          )
        `;
      }

      sql += `
        ORDER BY s.created_at DESC
      `;

      const result =
        await pool.query(
          sql,
          values
        );

      res.json(
        result.rows
      );
    } catch (error) {
      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/shop",
  auth,
  roles("shopkeeper"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             s.*,
             u.name AS owner_name,
             u.email AS owner_email,
             u.phone AS owner_phone
           FROM shops s
           JOIN users u
             ON u.id=s.owner_id
           WHERE s.owner_id=$1
           ORDER BY s.created_at DESC
           LIMIT 1`,
          [
            req.user.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "SHOPKEEPER SHOP ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/shops",
  auth,
  roles("shopkeeper"),
  async (
    req,
    res
  ) => {
    try {
      const {
        name,
        address,
        city,
        state,
        pincode,
        phone,
        description,
      } = req.body;

      if (!name) {
        return res.status(400).json({
          error:
            "Shop name is required",
        });
      }

      const existing =
        await pool.query(
          `SELECT id
           FROM shops
           WHERE owner_id=$1
           LIMIT 1`,
          [
            req.user.id,
          ]
        );

      if (
        existing.rowCount
      ) {
        return res.status(409).json({
          error:
            "Shop already exists",
        });
      }

      const result =
        await pool.query(
          `INSERT INTO shops
           (
             owner_id,
             name,
             address,
             city,
             state,
             pincode,
             phone,
             description,
             status
           )
           VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
           RETURNING *`,
          [
            req.user.id,
            name,
            address || null,
            city || null,
            state || null,
            pincode || null,
            phone || null,
            description || null,
          ]
        );

      res.status(201).json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "CREATE SHOP ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/products",
  auth,
  roles("shopkeeper"),
  async (
    req,
    res
  ) => {
    try {
      const shop =
        await pool.query(
          `SELECT
             id,
             owner_id,
             name,
             status
           FROM shops
           WHERE owner_id=$1
           ORDER BY created_at DESC
           LIMIT 1`,
          [
            req.user.id,
          ]
        );

      if (
        !shop.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shopData =
        shop.rows[0];

      const result =
        await pool.query(
          `SELECT *
           FROM products
           WHERE shop_id=$1
           ORDER BY created_at DESC`,
          [
            shopData.id,
          ]
        );

      res.json({
        shop:
          shopData,
        products:
          result.rows,
      });
    } catch (error) {
      console.error(
        "SHOPKEEPER PRODUCTS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/shops/:id/products",
  auth,
  roles("shopkeeper", "admin"),
  async (
    req,
    res
  ) => {
    try {
      const {
        name,
        description,
        category,
        price,
        stock,
        prescriptionRequired,
        images,
      } = req.body;

      if (!name) {
        return res.status(400).json({
          error:
            "Product name is required",
        });
      }

      const shopResult =
        await pool.query(
          `SELECT
             id,
             owner_id,
             status
           FROM shops
           WHERE id=$1
           LIMIT 1`,
          [
            req.params.id,
          ]
        );

      if (
        !shopResult.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        shopResult.rows[0];

      if (
        normalizeRole(
          req.user.role
        ) === "shopkeeper"
      ) {
        if (
          Number(
            shop.owner_id
          ) !==
          Number(
            req.user.id
          )
        ) {
          return res.status(403).json({
            error:
              "You are not the owner of this shop",
          });
        }

        if (
          normalizeStatus(
            shop.status
          ) !== "approved"
        ) {
          return res.status(403).json({
            error:
              "Admin must approve the shop before adding products",
          });
        }
      }

      if (
        images !== undefined &&
        !Array.isArray(images)
      ) {
        return res.status(400).json({
          error:
            "Images must be an array",
        });
      }

      if (
        Array.isArray(images) &&
        images.length > 5
      ) {
        return res.status(400).json({
          error:
            "Maximum 5 images allowed",
        });
      }

      const productResult =
        await pool.query(
          `INSERT INTO products
           (
             shop_id,
             name,
             description,
             category,
             price,
             stock,
             prescription_required,
             images,
             active
           )
           VALUES
           (
             $1,
             $2,
             $3,
             $4,
             $5,
             $6,
             $7,
             $8,
             true
           )
           RETURNING *`,
          [
            req.params.id,
            name,
            description || null,
            category || null,
            price == null
              ? 0
              : Number(price),
            stock == null
              ? 0
              : Number(stock),
            Boolean(
              prescriptionRequired
            ),
            [],
          ]
        );

      const product =
        productResult.rows[0];

      let savedImages = [];

      if (
        Array.isArray(images) &&
        images.length > 0
      ) {
        savedImages =
          await saveProductImages(
            images,
            product.id
          );

        const updated =
          await pool.query(
            `UPDATE products
             SET
               images=$1,
               updated_at=NOW()
             WHERE id=$2
             RETURNING *`,
            [
              savedImages,
              product.id,
            ]
          );

        if (
          updated.rowCount
        ) {
          return res.status(201).json(
            updated.rows[0]
          );
        }
      }

      res.status(201).json(
        product
      );
    } catch (error) {
      console.error(
        "CREATE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/shops/:shopId/products/:productId",
  auth,
  roles("shopkeeper", "admin"),
  async (
    req,
    res
  ) => {
    try {
      const {
        name,
        description,
        category,
        price,
        stock,
        prescriptionRequired,
        images,
        active,
      } = req.body;

      const shopResult =
        await pool.query(
          `SELECT
             id,
             owner_id,
             status
           FROM shops
           WHERE id=$1
           LIMIT 1`,
          [
            req.params.shopId,
          ]
        );

      if (
        !shopResult.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        shopResult.rows[0];

      if (
        normalizeRole(
          req.user.role
        ) === "shopkeeper"
      ) {
        if (
          Number(
            shop.owner_id
          ) !==
          Number(
            req.user.id
          )
        ) {
          return res.status(403).json({
            error:
              "You are not the owner of this shop",
          });
        }

        if (
          normalizeStatus(
            shop.status
          ) !== "approved"
        ) {
          return res.status(403).json({
            error:
              "Shop must be approved before editing products",
          });
        }
      }

      const oldResult =
        await pool.query(
          `SELECT *
           FROM products
           WHERE id=$1
             AND shop_id=$2
           LIMIT 1`,
          [
            req.params.productId,
            req.params.shopId,
          ]
        );

      if (
        !oldResult.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      const oldProduct =
        oldResult.rows[0];

      let finalImages =
        oldProduct.images || [];

      if (
        images !== undefined
      ) {
        if (
          !Array.isArray(images)
        ) {
          return res.status(400).json({
            error:
              "Images must be an array",
          });
        }

        if (
          images.length > 5
        ) {
          return res.status(400).json({
            error:
              "Maximum 5 images allowed",
          });
        }

        const oldImages =
          Array.isArray(
            oldProduct.images
          )
            ? oldProduct.images
            : [];

        const keepImages =
          images.filter(
            (image) =>
              typeof image ===
                "string" &&
              image.startsWith(
                "/uploads/products/"
              ) &&
              oldImages.includes(
                image
              )
          );

        const newImages =
          images.filter(
            (image) =>
              typeof image ===
                "string" &&
              image.startsWith(
                "data:image/"
              )
          );

        const newlySaved =
          await saveProductImages(
            newImages,
            oldProduct.id
          );

        finalImages =
          [
            ...keepImages,
            ...newlySaved,
          ].slice(
            0,
            5
          );

        const removedImages =
          oldImages.filter(
            (oldImage) =>
              !finalImages.includes(
                oldImage
              )
          );

        deleteProductImages(
          removedImages
        );
      }

      const result =
        await pool.query(
          `UPDATE products
           SET
             name=COALESCE($1,name),
             description=COALESCE(
               $2,
               description
             ),
             category=COALESCE(
               $3,
               category
             ),
             price=COALESCE(
               $4,
               price
             ),
             stock=COALESCE(
               $5,
               stock
             ),
             prescription_required=
               COALESCE(
                 $6,
                 prescription_required
               ),
             images=$7,
             active=COALESCE(
               $8,
               active
             ),
             updated_at=NOW()
           WHERE id=$9
             AND shop_id=$10
           RETURNING *`,
          [
            name ?? null,
            description ?? null,
            category ?? null,
            price == null
              ? null
              : Number(price),
            stock == null
              ? null
              : Number(stock),
            prescriptionRequired ==
            null
              ? null
              : Boolean(
                  prescriptionRequired
                ),
            finalImages,
            active == null
              ? null
              : Boolean(active),
            req.params.productId,
            req.params.shopId,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "UPDATE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.delete(
  "/api/shops/:shopId/products/:productId",
  auth,
  roles("shopkeeper", "admin"),
  async (
    req,
    res
  ) => {
    try {
      const shopResult =
        await pool.query(
          `SELECT
             id,
             owner_id,
             status
           FROM shops
           WHERE id=$1
           LIMIT 1`,
          [
            req.params.shopId,
          ]
        );

      if (
        !shopResult.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        shopResult.rows[0];

      if (
        normalizeRole(
          req.user.role
        ) === "shopkeeper"
      ) {
        if (
          Number(
            shop.owner_id
          ) !==
          Number(
            req.user.id
          )
        ) {
          return res.status(403).json({
            error:
              "You are not the owner of this shop",
          });
        }

        if (
          normalizeStatus(
            shop.status
          ) !== "approved"
        ) {
          return res.status(403).json({
            error:
              "Shop must be approved before removing products",
          });
        }
      }

      const productResult =
        await pool.query(
          `SELECT *
           FROM products
           WHERE id=$1
             AND shop_id=$2
           LIMIT 1`,
          [
            req.params.productId,
            req.params.shopId,
          ]
        );

      if (
        !productResult.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      const product =
        productResult.rows[0];

      const result =
        await pool.query(
          `UPDATE products
           SET
             active=false,
             updated_at=NOW()
           WHERE id=$1
             AND shop_id=$2
           RETURNING *`,
          [
            req.params.productId,
            req.params.shopId,
          ]
        );

      deleteProductImages(
        Array.isArray(
          product.images
        )
          ? product.images
          : []
      );

      res.json({
        message:
          "Product removed successfully",
        product:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "DELETE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shops/:shopId/products",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.*,
             s.name AS shop_name,
             s.status AS shop_status
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE p.shop_id=$1
             AND p.active=true
             AND LOWER(s.status)='approved'
           ORDER BY p.created_at DESC`,
          [
            req.params.shopId,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "SHOP PRODUCTS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/products",
  async (
    req,
    res
  ) => {
    try {
      const {
        shopId,
        category,
        search,
      } = req.query;

      const values = [];

      let sql = `
        SELECT
          p.*,
          s.name AS shop_name,
          s.address AS shop_address,
          s.city AS shop_city
        FROM products p
        JOIN shops s
          ON s.id=p.shop_id
        WHERE p.active=true
          AND LOWER(s.status)='approved'
      `;

      if (shopId) {
        values.push(
          Number(shopId)
        );

        sql += `
          AND p.shop_id=$${values.length}
        `;
      }

      if (category) {
        values.push(
          category
        );

        sql += `
          AND p.category=$${values.length}
        `;
      }

      if (search) {
        values.push(
          `%${search}%`
        );

        sql += `
          AND (
            p.name ILIKE $${values.length}
            OR
            p.description ILIKE $${values.length}
          )
        `;
      }

      sql += `
        ORDER BY p.created_at DESC
      `;

      const result =
        await pool.query(
          sql,
          values
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "PRODUCT LIST ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/products/:id",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.*,
             s.name AS shop_name,
             s.address AS shop_address,
             s.city AS shop_city
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE p.id=$1
             AND p.active=true
             AND LOWER(s.status)='approved'`,
          [
            req.params.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "SINGLE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/admin/products",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.*,
             s.name AS shop_name,
             s.status AS shop_status,
             u.name AS owner_name,
             u.email AS owner_email
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           JOIN users u
             ON u.id=s.owner_id
           ORDER BY p.created_at DESC`
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "ADMIN PRODUCTS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/admin/shops",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             s.*,
             u.name AS owner_name,
             u.email AS owner_email,
             u.phone AS owner_phone
           FROM shops s
           JOIN users u
             ON u.id=s.owner_id
           ORDER BY s.created_at DESC`
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "ADMIN SHOPS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/admin/shops/:id/approve",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `UPDATE shops
           SET
             status='approved',
             approved_at=NOW()
           WHERE id=$1
           RETURNING *`,
          [
            req.params.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        result.rows[0];

      await sendPushToUser(
        shop.owner_id,
        "Shop Approved",
        "Your shop has been approved. You can now add products.",
        {
          shopId:
            shop.id,
          status:
            "approved",
        },
        "shop_approved"
      );

      res.json(
        shop
      );
    } catch (error) {
      console.error(
        "APPROVE SHOP ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/admin/shops/:id/reject",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const {
        reason,
      } = req.body;

      const result =
        await pool.query(
          `UPDATE shops
           SET
             status='rejected',
             rejection_reason=$2
           WHERE id=$1
           RETURNING *`,
          [
            req.params.id,
            reason ||
              null,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        result.rows[0];

      await sendPushToUser(
        shop.owner_id,
        "Shop Rejected",
        reason ||
          "Your shop application was rejected.",
        {
          shopId:
            shop.id,
          status:
            "rejected",
        },
        "shop_rejected"
      );

      res.json(
        shop
      );
    } catch (error) {
      console.error(
        "REJECT SHOP ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/admin/shops/:id/suspend",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `UPDATE shops
           SET status='suspended'
           WHERE id=$1
           RETURNING *`,
          [
            req.params.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "SUSPEND SHOP ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/admin/shops/:id/activate",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `UPDATE shops
           SET status='approved'
           WHERE id=$1
           RETURNING *`,
          [
            req.params.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "ACTIVATE SHOP ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/customer/profile",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,
             name,
             email,
             phone,
             created_at
           FROM users
           WHERE id=$1
             AND role='customer'`,
          [
            req.user.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Customer not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "CUSTOMER PROFILE ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/customer/profile",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const {
        name,
        phone,
      } = req.body;

      const result =
        await pool.query(
          `UPDATE users
           SET
             name=COALESCE($1,name),
             phone=COALESCE($2,phone)
           WHERE id=$3
             AND role='customer'
           RETURNING
             id,
             name,
             email,
             phone`,
          [
            name ||
              null,
            phone ||
              null,
            req.user.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Customer not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "UPDATE CUSTOMER ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/customer/addresses",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT *
           FROM addresses
           WHERE user_id=$1
           ORDER BY
             is_default DESC,
             created_at DESC`,
          [
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "GET ADDRESSES ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/customer/addresses",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const {
        label,
        address,
        city,
        state,
        pincode,
        latitude,
        longitude,
        isDefault = false,
      } = req.body;

      if (!address) {
        return res.status(400).json({
          error:
            "Address is required",
        });
      }

      if (isDefault) {
        await pool.query(
          `UPDATE addresses
           SET is_default=false
           WHERE user_id=$1`,
          [
            req.user.id,
          ]
        );
      }

      const result =
        await pool.query(
          `INSERT INTO addresses
           (
             user_id,
             label,
             address,
             city,
             state,
             pincode,
             latitude,
             longitude,
             is_default
           )
           VALUES
           (
             $1,$2,$3,$4,$5,$6,$7,$8,$9
           )
           RETURNING *`,
          [
            req.user.id,
            label || "Home",
            address,
            city || null,
            state || null,
            pincode || null,
            latitude == null
              ? null
              : Number(latitude),
            longitude == null
              ? null
              : Number(longitude),
            Boolean(isDefault),
          ]
        );

      res.status(201).json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "CREATE ADDRESS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/customer/addresses/:id",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const {
        label,
        address,
        city,
        state,
        pincode,
        latitude,
        longitude,
        isDefault,
      } = req.body;

      if (isDefault) {
        await pool.query(
          `UPDATE addresses
           SET is_default=false
           WHERE user_id=$1`,
          [
            req.user.id,
          ]
        );
      }

      const result =
        await pool.query(
          `UPDATE addresses
           SET
             label=COALESCE($1,label),
             address=COALESCE($2,address),
             city=COALESCE($3,city),
             state=COALESCE($4,state),
             pincode=COALESCE($5,pincode),
             latitude=COALESCE($6,latitude),
             longitude=COALESCE($7,longitude),
             is_default=COALESCE(
               $8,
               is_default
             )
           WHERE id=$9
             AND user_id=$10
           RETURNING *`,
          [
            label ?? null,
            address ?? null,
            city ?? null,
            state ?? null,
            pincode ?? null,
            latitude == null
              ? null
              : Number(latitude),
            longitude == null
              ? null
              : Number(longitude),
            isDefault == null
              ? null
              : Boolean(isDefault),
            req.params.id,
            req.user.id,
          ]
        );

      if (!result.rowCount) {
        return res.status(404).json({
          error:
            "Address not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "UPDATE ADDRESS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.delete(
  "/api/customer/addresses/:id",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `DELETE FROM addresses
           WHERE id=$1
             AND user_id=$2
           RETURNING *`,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (!result.rowCount) {
        return res.status(404).json({
          error:
            "Address not found",
        });
      }

      res.json({
        message:
          "Address deleted successfully",
      });
    } catch (error) {
      console.error(
        "DELETE ADDRESS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/cart",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             ci.id,
             ci.product_id,
             ci.quantity,
             p.name,
             p.price,
             p.images,
             p.stock,
             p.shop_id,
             s.name AS shop_name
           FROM cart_items ci
           JOIN products p
             ON p.id=ci.product_id
           JOIN shops s
             ON s.id=p.shop_id
           WHERE ci.user_id=$1
             AND p.active=true
             AND LOWER(s.status)='approved'
           ORDER BY ci.created_at DESC`,
          [
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "GET CART ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/cart",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const {
        productId,
        quantity = 1,
      } = req.body;

      const qty =
        Number(quantity);

      if (
        !productId ||
        !Number.isInteger(qty) ||
        qty < 1
      ) {
        return res.status(400).json({
          error:
            "Valid productId and quantity required",
        });
      }

      const productResult =
        await pool.query(
          `SELECT
             p.*,
             s.status AS shop_status
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE p.id=$1
             AND p.active=true
             AND LOWER(s.status)='approved'`,
          [
            productId,
          ]
        );

      if (
        !productResult.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not available",
        });
      }

      const product =
        productResult.rows[0];

      if (
        Number(product.stock) <
        qty
      ) {
        return res.status(400).json({
          error:
            "Insufficient stock",
        });
      }

      const result =
        await pool.query(
          `INSERT INTO cart_items
           (
             user_id,
             product_id,
             quantity
           )
           VALUES
           ($1,$2,$3)
           ON CONFLICT
             (user_id,product_id)
           DO UPDATE SET
             quantity=
               cart_items.quantity +
               EXCLUDED.quantity,
             updated_at=NOW()
           RETURNING *`,
          [
            req.user.id,
            productId,
            qty,
          ]
        );

      res.status(201).json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "ADD CART ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/cart/:productId",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const qty =
        Number(
          req.body.quantity
        );

      if (
        !Number.isInteger(qty) ||
        qty < 1
      ) {
        return res.status(400).json({
          error:
            "Quantity must be at least 1",
        });
      }

      const productResult =
        await pool.query(
          `SELECT
             p.stock,
             s.status AS shop_status
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE p.id=$1
             AND p.active=true
             AND LOWER(s.status)='approved'`,
          [
            req.params.productId,
          ]
        );

      if (
        !productResult.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      if (
        Number(
          productResult.rows[0]
            .stock
        ) < qty
      ) {
        return res.status(400).json({
          error:
            "Insufficient stock",
        });
      }

      const result =
        await pool.query(
          `UPDATE cart_items
           SET
             quantity=$1,
             updated_at=NOW()
           WHERE user_id=$2
             AND product_id=$3
           RETURNING *`,
          [
            qty,
            req.user.id,
            req.params.productId,
          ]
        );

      if (!result.rowCount) {
        return res.status(404).json({
          error:
            "Cart item not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "UPDATE CART ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.delete(
  "/api/cart/:productId",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `DELETE FROM cart_items
           WHERE user_id=$1
             AND product_id=$2
           RETURNING *`,
          [
            req.user.id,
            req.params.productId,
          ]
        );

      if (!result.rowCount) {
        return res.status(404).json({
          error:
            "Cart item not found",
        });
      }

      res.json({
        message:
          "Cart item removed successfully",
      });
    } catch (error) {
      console.error(
        "DELETE CART ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/orders",
  auth,
  roles("shopkeeper"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             o.*,
             s.name AS shop_name
           FROM orders o
           JOIN shops s
             ON s.id=o.shop_id
           WHERE s.owner_id=$1
           ORDER BY o.created_at DESC`,
          [
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "SHOPKEEPER ORDERS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/customer/orders",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT *
           FROM orders
           WHERE user_id=$1
           ORDER BY created_at DESC`,
          [
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "CUSTOMER ORDERS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/admin/orders",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             o.*,
             s.name AS shop_name,
             u.name AS customer_name,
             u.email AS customer_email
           FROM orders o
           LEFT JOIN shops s
             ON s.id=o.shop_id
           LEFT JOIN users u
             ON u.id=o.user_id
           ORDER BY o.created_at DESC`
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "ADMIN ORDERS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/admin/users",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,
             name,
             email,
             phone,
             role,
             created_at
           FROM users
           ORDER BY created_at DESC`
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "ADMIN USERS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/admin/users/:id",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const {
        name,
        phone,
        role,
      } = req.body;

      const validRoles = [
        "admin",
        "customer",
        "shopkeeper",
      ];

      if (
        role &&
        !validRoles.includes(
          normalizeRole(role)
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid role",
        });
      }

      const result =
        await pool.query(
          `UPDATE users
           SET
             name=COALESCE($1,name),
             phone=COALESCE($2,phone),
             role=COALESCE($3,role)
           WHERE id=$4
           RETURNING
             id,
             name,
             email,
             phone,
             role`,
          [
            name ?? null,
            phone ?? null,
            role
              ? normalizeRole(
                  role
                )
              : null,
            req.params.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "ADMIN USER UPDATE ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.delete(
  "/api/admin/users/:id",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      if (
        Number(
          req.params.id
        ) ===
        Number(
          req.user.id
        )
      ) {
        return res.status(400).json({
          error:
            "You cannot delete your own admin account",
        });
      }

      const result =
        await pool.query(
          `DELETE FROM users
           WHERE id=$1
           RETURNING id,email`,
          [
            req.params.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "User not found",
        });
      }

      res.json({
        message:
          "User deleted successfully",
        user:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "ADMIN USER DELETE ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/admin/dashboard",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const [
        users,
        shops,
        products,
        orders,
      ] =
        await Promise.all([
          pool.query(
            `SELECT COUNT(*)::int AS count
             FROM users`
          ),
          pool.query(
            `SELECT COUNT(*)::int AS count
             FROM shops`
          ),
          pool.query(
            `SELECT COUNT(*)::int AS count
             FROM products
             WHERE active=true`
          ),
          pool.query(
            `SELECT COUNT(*)::int AS count
             FROM orders`
          ),
        ]);

      res.json({
        users:
          users.rows[0]
            .count,
        shops:
          shops.rows[0]
            .count,
        products:
          products.rows[0]
            .count,
        orders:
          orders.rows[0]
            .count,
      });
    } catch (error) {
      console.error(
        "ADMIN DASHBOARD ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/admin/products/:id/activate",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `UPDATE products
           SET
             active=true,
             updated_at=NOW()
           WHERE id=$1
           RETURNING *`,
          [
            req.params.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "ACTIVATE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/admin/products/:id/deactivate",
  auth,
  roles("admin"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `UPDATE products
           SET
             active=false,
             updated_at=NOW()
           WHERE id=$1
           RETURNING *`,
          [
            req.params.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "DEACTIVATE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/categories",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT DISTINCT category
           FROM products
           WHERE active=true
             AND category IS NOT NULL
             AND category <> ''
           ORDER BY category`
        );

      res.json(
        result.rows.map(
          (row) =>
            row.category
        )
      );
    } catch (error) {
      console.error(
        "CATEGORIES ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/search/products",
  async (
    req,
    res
  ) => {
    try {
      const {
        q = "",
      } = req.query;

      if (!String(q).trim()) {
        return res.json([]);
      }

      const search =
        `%${String(q).trim()}%`;

      const result =
        await pool.query(
          `SELECT
             p.*,
             s.name AS shop_name,
             s.city AS shop_city
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE p.active=true
             AND LOWER(s.status)='approved'
             AND (
               p.name ILIKE $1
               OR p.description ILIKE $1
               OR p.category ILIKE $1
             )
           ORDER BY
             p.created_at DESC`,
          [
            search,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "PRODUCT SEARCH ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);
app.get(
  "/api/orders/:id",
  auth,
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT *
           FROM orders
           WHERE id=$1
             AND (
               user_id=$2
               OR
               EXISTS (
                 SELECT 1
                 FROM shops s
                 WHERE s.id=orders.shop_id
                   AND s.owner_id=$2
               )
               OR
               $3='admin'
             )
           LIMIT 1`,
          [
            req.params.id,
            req.user.id,
            normalizeRole(
              req.user.role
            ),
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Order not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "GET ORDER ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/orders",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    const client =
      await pool.connect();

    try {
      const {
        addressId,
        paymentMethod = "cod",
        notes,
      } = req.body;

      await client.query(
        "BEGIN"
      );

      const cartResult =
        await client.query(
          `SELECT
             ci.product_id,
             ci.quantity,
             p.name,
             p.price,
             p.stock,
             p.shop_id,
             s.name AS shop_name
           FROM cart_items ci
           JOIN products p
             ON p.id=ci.product_id
           JOIN shops s
             ON s.id=p.shop_id
           WHERE ci.user_id=$1
             AND p.active=true
             AND LOWER(s.status)='approved'
           FOR UPDATE`,
          [
            req.user.id,
          ]
        );

      if (
        !cartResult.rowCount
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          error:
            "Cart is empty",
        });
      }

      const items =
        cartResult.rows;

      for (
        const item of items
      ) {
        if (
          Number(item.stock) <
          Number(item.quantity)
        ) {
          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error:
              `${item.name} does not have enough stock`,
          });
        }
      }

      let subtotal = 0;

      for (
        const item of items
      ) {
        subtotal +=
          Number(item.price) *
          Number(item.quantity);
      }

      const deliveryFee =
        subtotal >= 500
          ? 0
          : 40;

      const total =
        subtotal +
        deliveryFee;

      let address = null;

      if (addressId) {
        const addressResult =
          await client.query(
            `SELECT *
             FROM addresses
             WHERE id=$1
               AND user_id=$2
             LIMIT 1`,
            [
              addressId,
              req.user.id,
            ]
          );

        if (
          !addressResult.rowCount
        ) {
          await client.query(
            "ROLLBACK"
          );

          return res.status(400).json({
            error:
              "Address not found",
          });
        }

        address =
          addressResult.rows[0];
      }

      const shopIds = [
        ...new Set(
          items.map(
            (item) =>
              Number(
                item.shop_id
              )
          )
        ),
      ];

      if (
        shopIds.length > 1
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          error:
            "Products from multiple shops must be ordered separately",
        });
      }

      const shopId =
        shopIds[0];

      const orderResult =
        await client.query(
          `INSERT INTO orders
           (
             user_id,
             shop_id,
             subtotal,
             delivery_fee,
             total,
             payment_method,
             payment_status,
             order_status,
             address_id,
             notes
           )
           VALUES
           (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
           )
           RETURNING *`,
          [
            req.user.id,
            shopId,
            subtotal,
            deliveryFee,
            total,
            paymentMethod,
            paymentMethod ===
            "cod"
              ? "pending"
              : "pending",
            "placed",
            addressId ||
              null,
            notes ||
              null,
          ]
        );

      const order =
        orderResult.rows[0];

      for (
        const item of items
      ) {
        await client.query(
          `INSERT INTO order_items
           (
             order_id,
             product_id,
             quantity,
             price
           )
           VALUES
           ($1,$2,$3,$4)`,
          [
            order.id,
            item.product_id,
            item.quantity,
            item.price,
          ]
        );

        await client.query(
          `UPDATE products
           SET
             stock=stock-$1,
             updated_at=NOW()
           WHERE id=$2`,
          [
            item.quantity,
            item.product_id,
          ]
        );
      }

      await client.query(
        `DELETE FROM cart_items
         WHERE user_id=$1`,
        [
          req.user.id,
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.status(201).json(
        order
      );
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (_) {}

      console.error(
        "CREATE ORDER ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    } finally {
      client.release();
    }
  }
);

app.put(
  "/api/orders/:id/status",
  auth,
  async (
    req,
    res
  ) => {
    try {
      const {
        status,
      } = req.body;

      const allowedStatuses = [
        "placed",
        "confirmed",
        "processing",
        "ready",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ];

      if (
        !allowedStatuses.includes(
          String(status)
            .trim()
            .toLowerCase()
        )
      ) {
        return res.status(400).json({
          error:
            "Invalid order status",
        });
      }

      const normalizedStatus =
        String(status)
          .trim()
          .toLowerCase();

      const orderResult =
        await pool.query(
          `SELECT
             o.*,
             s.owner_id
           FROM orders o
           LEFT JOIN shops s
             ON s.id=o.shop_id
           WHERE o.id=$1
           LIMIT 1`,
          [
            req.params.id,
          ]
        );

      if (
        !orderResult.rowCount
      ) {
        return res.status(404).json({
          error:
            "Order not found",
        });
      }

      const order =
        orderResult.rows[0];

      const currentRole =
        normalizeRole(
          req.user.role
        );

      const allowed =
        currentRole ===
          "admin" ||
        Number(
          order.user_id
        ) ===
          Number(
            req.user.id
          ) ||
        (
          currentRole ===
            "shopkeeper" &&
          Number(
            order.owner_id
          ) ===
            Number(
              req.user.id
            )
        );

      if (!allowed) {
        return res.status(403).json({
          error:
            "Access denied",
        });
      }

      const result =
        await pool.query(
          `UPDATE orders
           SET
             order_status=$1,
             updated_at=NOW()
           WHERE id=$2
           RETURNING *`,
          [
            normalizedStatus,
            req.params.id,
          ]
        );

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "UPDATE ORDER STATUS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/orders/:id/items",
  auth,
  roles("shopkeeper"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             oi.*,
             p.name,
             p.images
           FROM order_items oi
           JOIN products p
             ON p.id=oi.product_id
           JOIN orders o
             ON o.id=oi.order_id
           JOIN shops s
             ON s.id=o.shop_id
           WHERE oi.order_id=$1
             AND s.owner_id=$2
           ORDER BY oi.id`,
          [
            req.params.id,
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "SHOPKEEPER ORDER ITEMS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/customer/orders/:id/items",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             oi.*,
             p.name,
             p.images
           FROM order_items oi
           JOIN products p
             ON p.id=oi.product_id
           JOIN orders o
             ON o.id=oi.order_id
           WHERE oi.order_id=$1
             AND o.user_id=$2
           ORDER BY oi.id`,
          [
            req.params.id,
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "CUSTOMER ORDER ITEMS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/favorites/:productId",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `INSERT INTO favorites
           (
             user_id,
             product_id
           )
           VALUES
           ($1,$2)
           ON CONFLICT
             (user_id,product_id)
           DO NOTHING
           RETURNING *`,
          [
            req.user.id,
            req.params.productId,
          ]
        );

      res.status(201).json({
        message:
          "Product added to favorites",
        favorite:
          result.rows[0] ||
          null,
      });
    } catch (error) {
      console.error(
        "ADD FAVORITE ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.delete(
  "/api/favorites/:productId",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      await pool.query(
        `DELETE FROM favorites
         WHERE user_id=$1
           AND product_id=$2`,
        [
          req.user.id,
          req.params.productId,
        ]
      );

      res.json({
        message:
          "Product removed from favorites",
      });
    } catch (error) {
      console.error(
        "REMOVE FAVORITE ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/favorites",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             f.*,
             p.name,
             p.price,
             p.images,
             p.stock,
             p.shop_id,
             s.name AS shop_name
           FROM favorites f
           JOIN products p
             ON p.id=f.product_id
           JOIN shops s
             ON s.id=p.shop_id
           WHERE f.user_id=$1
             AND p.active=true
             AND LOWER(s.status)='approved'
           ORDER BY f.created_at DESC`,
          [
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "GET FAVORITES ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/products/:id/reviews",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             r.*,
             u.name AS user_name
           FROM product_reviews r
           JOIN users u
             ON u.id=r.user_id
           WHERE r.product_id=$1
           ORDER BY r.created_at DESC`,
          [
            req.params.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "GET REVIEWS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.post(
  "/api/products/:id/reviews",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const {
        rating,
        comment,
      } = req.body;

      const numericRating =
        Number(rating);

      if (
        !Number.isInteger(
          numericRating
        ) ||
        numericRating < 1 ||
        numericRating > 5
      ) {
        return res.status(400).json({
          error:
            "Rating must be between 1 and 5",
        });
      }

      const product =
        await pool.query(
          `SELECT id
           FROM products
           WHERE id=$1
           LIMIT 1`,
          [
            req.params.id,
          ]
        );

      if (
        !product.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      const result =
        await pool.query(
          `INSERT INTO product_reviews
           (
             product_id,
             user_id,
             rating,
             comment
           )
           VALUES
           ($1,$2,$3,$4)
           ON CONFLICT
             (product_id,user_id)
           DO UPDATE SET
             rating=EXCLUDED.rating,
             comment=EXCLUDED.comment,
             updated_at=NOW()
           RETURNING *`,
          [
            req.params.id,
            req.user.id,
            numericRating,
            comment ||
              null,
          ]
        );

      res.status(201).json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "ADD REVIEW ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.delete(
  "/api/products/:id/reviews",
  auth,
  roles("customer"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `DELETE FROM product_reviews
           WHERE product_id=$1
             AND user_id=$2
           RETURNING *`,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Review not found",
        });
      }

      res.json({
        message:
          "Review deleted successfully",
      });
    } catch (error) {
      console.error(
        "DELETE REVIEW ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shops/:id",
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             s.*,
             u.name AS owner_name,
             u.phone AS owner_phone
           FROM shops s
           JOIN users u
             ON u.id=s.owner_id
           WHERE s.id=$1
           LIMIT 1`,
          [
            req.params.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "GET SHOP ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/shopkeeper/shop",
  auth,
  roles("shopkeeper"),
  async (
    req,
    res
  ) => {
    try {
      const {
        name,
        address,
        city,
        state,
        pincode,
        phone,
        description,
      } = req.body;

      const result =
        await pool.query(
          `UPDATE shops
           SET
             name=COALESCE($1,name),
             address=COALESCE($2,address),
             city=COALESCE($3,city),
             state=COALESCE($4,state),
             pincode=COALESCE($5,pincode),
             phone=COALESCE($6,phone),
             description=COALESCE($7,description)
           WHERE owner_id=$8
           RETURNING *`,
          [
            name ?? null,
            address ?? null,
            city ?? null,
            state ?? null,
            pincode ?? null,
            phone ?? null,
            description ?? null,
            req.user.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "UPDATE SHOP ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/dashboard",
  auth,
  roles("shopkeeper"),
  async (
    req,
    res
  ) => {
    try {
      const shopResult =
        await pool.query(
          `SELECT *
           FROM shops
           WHERE owner_id=$1
           ORDER BY created_at DESC
           LIMIT 1`,
          [
            req.user.id,
          ]
        );

      if (
        !shopResult.rowCount
      ) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        shopResult.rows[0];

      const [
        products,
        activeProducts,
        orders,
      ] =
        await Promise.all([
          pool.query(
            `SELECT COUNT(*)::int AS count
             FROM products
             WHERE shop_id=$1`,
            [
              shop.id,
            ]
          ),
          pool.query(
            `SELECT COUNT(*)::int AS count
             FROM products
             WHERE shop_id=$1
               AND active=true`,
            [
              shop.id,
            ]
          ),
          pool.query(
            `SELECT COUNT(*)::int AS count
             FROM orders
             WHERE shop_id=$1`,
            [
              shop.id,
            ]
          ),
        ]);

      res.json({
        shop,
        products:
          products.rows[0]
            .count,
        activeProducts:
          activeProducts.rows[0]
            .count,
        orders:
          orders.rows[0]
            .count,
      });
    } catch (error) {
      console.error(
        "SHOPKEEPER DASHBOARD ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/product/:id",
  auth,
  roles("shopkeeper"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.*,
             s.name AS shop_name,
             s.status AS shop_status
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE p.id=$1
             AND s.owner_id=$2
           LIMIT 1`,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        "SHOPKEEPER PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/product-images/:id",
  auth,
  roles("shopkeeper"),
  async (
    req,
    res
  ) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.id,
             p.images
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE p.id=$1
             AND s.owner_id=$2
           LIMIT 1`,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (
        !result.rowCount
      ) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      res.json({
        id:
          result.rows[0].id,
        images:
          Array.isArray(
            result.rows[0].images
          )
            ? result.rows[0].images
            : [],
      });
    } catch (error) {
      console.error(
        "PRODUCT IMAGES ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);
app.post(
  "/api/upload/product-images",
  auth,
  roles("shopkeeper", "admin"),
  async (req, res) => {
    try {
      const {
        images,
        productId,
      } = req.body;

      if (!Array.isArray(images)) {
        return res.status(400).json({
          error: "Images array is required",
        });
      }

      if (images.length === 0) {
        return res.status(400).json({
          error: "At least one image is required",
        });
      }

      if (images.length > 5) {
        return res.status(400).json({
          error: "Maximum 5 images allowed",
        });
      }

      if (productId) {
        const productResult =
          await pool.query(
            `SELECT
               p.id,
               p.images,
               s.owner_id,
               s.status
             FROM products p
             JOIN shops s
               ON s.id=p.shop_id
             WHERE p.id=$1
             LIMIT 1`,
            [productId]
          );

        if (!productResult.rowCount) {
          return res.status(404).json({
            error: "Product not found",
          });
        }

        const product =
          productResult.rows[0];

        if (
          normalizeRole(req.user.role) ===
          "shopkeeper"
        ) {
          if (
            Number(product.owner_id) !==
            Number(req.user.id)
          ) {
            return res.status(403).json({
              error: "Access denied",
            });
          }

          if (
            normalizeStatus(product.status) !==
            "approved"
          ) {
            return res.status(403).json({
              error:
                "Shop must be approved first",
            });
          }
        }
      }

      const savedImages =
        await saveProductImages(
          images,
          productId || null
        );

      res.status(201).json({
        message:
          "Images uploaded successfully",
        images: savedImages,
      });
    } catch (error) {
      console.error(
        "UPLOAD PRODUCT IMAGES ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.delete(
  "/api/products/:productId/images",
  auth,
  roles("shopkeeper", "admin"),
  async (req, res) => {
    try {
      const {
        image,
      } = req.body;

      if (!image) {
        return res.status(400).json({
          error: "Image is required",
        });
      }

      const productResult =
        await pool.query(
          `SELECT
             p.id,
             p.images,
             s.owner_id,
             s.status
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE p.id=$1
           LIMIT 1`,
          [req.params.productId]
        );

      if (!productResult.rowCount) {
        return res.status(404).json({
          error: "Product not found",
        });
      }

      const product =
        productResult.rows[0];

      if (
        normalizeRole(req.user.role) ===
        "shopkeeper"
      ) {
        if (
          Number(product.owner_id) !==
          Number(req.user.id)
        ) {
          return res.status(403).json({
            error: "Access denied",
          });
        }

        if (
          normalizeStatus(product.status) !==
          "approved"
        ) {
          return res.status(403).json({
            error:
              "Shop must be approved first",
          });
        }
      }

      const oldImages =
        Array.isArray(product.images)
          ? product.images
          : [];

      const updatedImages =
        oldImages.filter(
          (item) =>
            item !== image
        );

      await pool.query(
        `UPDATE products
         SET
           images=$1,
           updated_at=NOW()
         WHERE id=$2`,
        [
          updatedImages,
          req.params.productId,
        ]
      );

      deleteProductImages([
        image,
      ]);

      res.json({
        message:
          "Image removed successfully",
        images:
          updatedImages,
      });
    } catch (error) {
      console.error(
        "DELETE PRODUCT IMAGE ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/products",
  auth,
  roles("shopkeeper"),
  async (req, res) => {
    try {
      const shopResult =
        await pool.query(
          `SELECT
             id,
             status
           FROM shops
           WHERE owner_id=$1
           ORDER BY created_at DESC
           LIMIT 1`,
          [req.user.id]
        );

      if (!shopResult.rowCount) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        shopResult.rows[0];

      const result =
        await pool.query(
          `SELECT *
           FROM products
           WHERE shop_id=$1
           ORDER BY created_at DESC`,
          [shop.id]
        );

      res.json({
        shopStatus:
          shop.status,
        canAddProduct:
          normalizeStatus(
            shop.status
          ) === "approved",
        products:
          result.rows,
      });
    } catch (error) {
      console.error(
        "SHOPKEEPER PRODUCTS ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/shop-status",
  auth,
  roles("shopkeeper"),
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             id,
             name,
             status,
             rejection_reason,
             approved_at
           FROM shops
           WHERE owner_id=$1
           ORDER BY created_at DESC
           LIMIT 1`,
          [req.user.id]
        );

      if (!result.rowCount) {
        return res.json({
          hasShop: false,
          status: "not_created",
          canAddProduct: false,
        });
      }

      const shop =
        result.rows[0];

      const approved =
        normalizeStatus(
          shop.status
        ) === "approved";

      res.json({
        hasShop: true,
        shopId:
          shop.id,
        name:
          shop.name,
        status:
          shop.status,
        rejectionReason:
          shop.rejection_reason,
        approvedAt:
          shop.approved_at,
        canAddProduct:
          approved,
      });
    } catch (error) {
      console.error(
        "SHOP STATUS ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.post(
  "/api/shopkeeper/products",
  auth,
  roles("shopkeeper"),
  async (req, res) => {
    try {
      const shopResult =
        await pool.query(
          `SELECT
             id,
             status
           FROM shops
           WHERE owner_id=$1
           ORDER BY created_at DESC
           LIMIT 1`,
          [req.user.id]
        );

      if (!shopResult.rowCount) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        shopResult.rows[0];

      if (
        normalizeStatus(
          shop.status
        ) !== "approved"
      ) {
        return res.status(403).json({
          error:
            "Admin approval required before adding products",
          shopStatus:
            shop.status,
          canAddProduct:
            false,
        });
      }

      const {
        name,
        description,
        category,
        price,
        stock,
        prescriptionRequired,
        images,
      } = req.body;

      if (
        !name ||
        !String(name).trim()
      ) {
        return res.status(400).json({
          error:
            "Product name is required",
        });
      }

      const imageArray =
        Array.isArray(images)
          ? images
          : [];

      if (
        imageArray.length > 5
      ) {
        return res.status(400).json({
          error:
            "Maximum 5 images allowed",
        });
      }

      const result =
        await pool.query(
          `INSERT INTO products
           (
             shop_id,
             name,
             description,
             category,
             price,
             stock,
             prescription_required,
             images,
             active
           )
           VALUES
           (
             $1,$2,$3,$4,$5,$6,$7,$8,true
           )
           RETURNING *`,
          [
            shop.id,
            String(name).trim(),
            description ||
              null,
            category ||
              null,
            Number(price || 0),
            Number(stock || 0),
            Boolean(
              prescriptionRequired
            ),
            [],
          ]
        );

      const product =
        result.rows[0];

      let finalImages = [];

      if (
        imageArray.length
      ) {
        finalImages =
          await saveProductImages(
            imageArray,
            product.id
          );

        const updateResult =
          await pool.query(
            `UPDATE products
             SET
               images=$1,
               updated_at=NOW()
             WHERE id=$2
             RETURNING *`,
            [
              finalImages,
              product.id,
            ]
          );

        if (
          updateResult.rowCount
        ) {
          return res.status(201).json({
            message:
              "Product added successfully",
            product:
              updateResult.rows[0],
          });
        }
      }

      res.status(201).json({
        message:
          "Product added successfully",
        product,
      });
    } catch (error) {
      console.error(
        "SHOPKEEPER ADD PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.put(
  "/api/shopkeeper/products/:id",
  auth,
  roles("shopkeeper"),
  async (req, res) => {
    try {
      const shopResult =
        await pool.query(
          `SELECT
             id,
             status
           FROM shops
           WHERE owner_id=$1
           ORDER BY created_at DESC
           LIMIT 1`,
          [req.user.id]
        );

      if (!shopResult.rowCount) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        shopResult.rows[0];

      if (
        normalizeStatus(
          shop.status
        ) !== "approved"
      ) {
        return res.status(403).json({
          error:
            "Admin approval required",
        });
      }

      const {
        name,
        description,
        category,
        price,
        stock,
        prescriptionRequired,
        images,
        active,
      } = req.body;

      const existing =
        await pool.query(
          `SELECT *
           FROM products
           WHERE id=$1
             AND shop_id=$2
           LIMIT 1`,
          [
            req.params.id,
            shop.id,
          ]
        );

      if (!existing.rowCount) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      const oldProduct =
        existing.rows[0];

      let finalImages =
        Array.isArray(
          oldProduct.images
        )
          ? oldProduct.images
          : [];

      if (
        images !== undefined
      ) {
        if (
          !Array.isArray(images)
        ) {
          return res.status(400).json({
            error:
              "Images must be an array",
          });
        }

        if (
          images.length > 5
        ) {
          return res.status(400).json({
            error:
              "Maximum 5 images allowed",
          });
        }

        const oldImages =
          Array.isArray(
            oldProduct.images
          )
            ? oldProduct.images
            : [];

        const existingImages =
          images.filter(
            (item) =>
              typeof item ===
                "string" &&
              oldImages.includes(
                item
              )
          );

        const newImages =
          images.filter(
            (item) =>
              typeof item ===
                "string" &&
              item.startsWith(
                "data:image/"
              )
          );

        const savedNewImages =
          await saveProductImages(
            newImages,
            oldProduct.id
          );

        finalImages = [
          ...existingImages,
          ...savedNewImages,
        ].slice(
          0,
          5
        );

        const removed =
          oldImages.filter(
            (item) =>
              !finalImages.includes(
                item
              )
          );

        deleteProductImages(
          removed
        );
      }

      const result =
        await pool.query(
          `UPDATE products
           SET
             name=COALESCE($1,name),
             description=COALESCE(
               $2,
               description
             ),
             category=COALESCE(
               $3,
               category
             ),
             price=COALESCE(
               $4,
               price
             ),
             stock=COALESCE(
               $5,
               stock
             ),
             prescription_required=
               COALESCE(
                 $6,
                 prescription_required
               ),
             images=$7,
             active=COALESCE(
               $8,
               active
             ),
             updated_at=NOW()
           WHERE id=$9
             AND shop_id=$10
           RETURNING *`,
          [
            name ?? null,
            description ?? null,
            category ?? null,
            price == null
              ? null
              : Number(price),
            stock == null
              ? null
              : Number(stock),
            prescriptionRequired ==
            null
              ? null
              : Boolean(
                  prescriptionRequired
                ),
            finalImages,
            active == null
              ? null
              : Boolean(active),
            req.params.id,
            shop.id,
          ]
        );

      res.json({
        message:
          "Product updated successfully",
        product:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "SHOPKEEPER UPDATE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.delete(
  "/api/shopkeeper/products/:id",
  auth,
  roles("shopkeeper"),
  async (req, res) => {
    try {
      const shopResult =
        await pool.query(
          `SELECT
             id,
             status
           FROM shops
           WHERE owner_id=$1
           ORDER BY created_at DESC
           LIMIT 1`,
          [req.user.id]
        );

      if (!shopResult.rowCount) {
        return res.status(404).json({
          error:
            "Shop not found",
        });
      }

      const shop =
        shopResult.rows[0];

      if (
        normalizeStatus(
          shop.status
        ) !== "approved"
      ) {
        return res.status(403).json({
          error:
            "Admin approval required",
        });
      }

      const productResult =
        await pool.query(
          `SELECT *
           FROM products
           WHERE id=$1
             AND shop_id=$2
           LIMIT 1`,
          [
            req.params.id,
            shop.id,
          ]
        );

      if (!productResult.rowCount) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      const product =
        productResult.rows[0];

      await pool.query(
        `UPDATE products
         SET
           active=false,
           updated_at=NOW()
         WHERE id=$1
           AND shop_id=$2`,
        [
          req.params.id,
          shop.id,
        ]
      );

      deleteProductImages(
        Array.isArray(
          product.images
        )
          ? product.images
          : []
      );

      res.json({
        message:
          "Product removed successfully",
      });
    } catch (error) {
      console.error(
        "SHOPKEEPER DELETE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.post(
  "/api/shopkeeper/products/:id/restore",
  auth,
  roles("shopkeeper"),
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `UPDATE products p
           SET
             active=true,
             updated_at=NOW()
           FROM shops s
           WHERE p.id=$1
             AND p.shop_id=s.id
             AND s.owner_id=$2
             AND LOWER(s.status)='approved'
           RETURNING p.*`,
          [
            req.params.id,
            req.user.id,
          ]
        );

      if (!result.rowCount) {
        return res.status(404).json({
          error:
            "Product not found or shop is not approved",
        });
      }

      res.json({
        message:
          "Product restored successfully",
        product:
          result.rows[0],
      });
    } catch (error) {
      console.error(
        "RESTORE PRODUCT ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/products/all",
  auth,
  roles("shopkeeper"),
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.*
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE s.owner_id=$1
           ORDER BY p.created_at DESC`,
          [
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "ALL SHOPKEEPER PRODUCTS ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/products/active",
  auth,
  roles("shopkeeper"),
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.*
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE s.owner_id=$1
             AND p.active=true
           ORDER BY p.created_at DESC`,
          [
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "ACTIVE SHOPKEEPER PRODUCTS ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.get(
  "/api/shopkeeper/products/removed",
  auth,
  roles("shopkeeper"),
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `SELECT
             p.*
           FROM products p
           JOIN shops s
             ON s.id=p.shop_id
           WHERE s.owner_id=$1
             AND p.active=false
           ORDER BY p.updated_at DESC`,
          [
            req.user.id,
          ]
        );

      res.json(
        result.rows
      );
    } catch (error) {
      console.error(
        "REMOVED SHOPKEEPER PRODUCTS ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.get(
  "/api/health",
  async (
    req,
    res
  ) => {
    try {
      await pool.query(
        "SELECT 1"
      );

      res.json({
        status:
          "ok",
        database:
          "connected",
        time:
          new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        status:
          "error",
        database:
          "disconnected",
        error:
          error.message,
      });
    }
  }
);

app.use(
  (
    req,
    res
  ) => {
    res.status(404).json({
      error:
        "API route not found",
      path:
        req.originalUrl,
    });
  }
);

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "GLOBAL ERROR:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(error);
    }

    res.status(500).json({
      error:
        error.message ||
        "Internal server error",
    });
  }
);

async function initDatabase() {
  try {
    // Main database schema
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role VARCHAR(30) NOT NULL DEFAULT 'customer',
        name VARCHAR(120) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20),
        password_hash TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS shops (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
        shop_name VARCHAR(160) NOT NULL,
        category VARCHAR(50) NOT NULL,
        gst_number VARCHAR(40),
        pan_number VARCHAR(30),
        address TEXT,
        latitude NUMERIC(10,7),
        longitude NUMERIC(10,7),
        opening_time TIME,
        closing_time TIME,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        documents JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        price NUMERIC(12,2) NOT NULL DEFAULT 0,
        stock INT NOT NULL DEFAULT 0,
        prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
        images JSONB NOT NULL DEFAULT '[]'::jsonb,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL REFERENCES users(id),
        shop_id UUID NOT NULL REFERENCES shops(id),
        delivery_partner_id UUID REFERENCES users(id),
        status VARCHAR(40) NOT NULL DEFAULT 'pending',
        subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
        delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 30,
        shop_commission NUMERIC(12,2) NOT NULL DEFAULT 0,
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        cancel_until TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cancellation_status VARCHAR(30),
        payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
        cashfree_order_id VARCHAR(100),
        payment_session_id TEXT,
        delivery_otp_hash TEXT,
        pickup_otp_hash TEXT,
        address JSONB NOT NULL DEFAULT '{}'::jsonb,
        prescription_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id),
        quantity INT NOT NULL DEFAULT 1,
        unit_price NUMERIC(12,2) NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS cart_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity INT NOT NULL DEFAULT 1,
        UNIQUE(user_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS favorites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        UNIQUE(user_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS addresses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        full_name VARCHAR(120) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        house_address TEXT NOT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        pincode VARCHAR(10) NOT NULL,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        label VARCHAR(30) NOT NULL DEFAULT 'Shop',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS product_reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL,
        review TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS delivery_locations (
        id BIGSERIAL PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        delivery_partner_id UUID NOT NULL REFERENCES users(id),
        latitude NUMERIC(10,7) NOT NULL,
        longitude NUMERIC(10,7) NOT NULL,
        accuracy NUMERIC(10,2),
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS financial_ledger (
        id BIGSERIAL PRIMARY KEY,
        order_id UUID REFERENCES orders(id),
        owner_type VARCHAR(30) NOT NULL,
        owner_id UUID,
        entry_type VARCHAR(30) NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        available_at TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        provider VARCHAR(30) NOT NULL DEFAULT 'cashfree',
        provider_order_id VARCHAR(120),
        amount NUMERIC(12,2) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'created',
        raw JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS otp_codes (
        id BIGSERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        purpose VARCHAR(30) NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_id UUID,
        action VARCHAR(120) NOT NULL,
        entity_type VARCHAR(50),
        entity_id UUID,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS push_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        platform VARCHAR(20),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notification_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        type VARCHAR(60) NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    console.log("Database initialized successfully");

  } catch (error) {
    console.error("DATABASE INITIALIZATION ERROR:", error);
    throw error;
  }
}

async function startServer() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      HOST,
      () => {
        console.log(
          "================================="
        );

        console.log(
          `Server running on http://${HOST}:${PORT}`
        );

        console.log(
          `Upload folder: ${uploadsDir}`
        );

        console.log(
          "Database connected"
        );

        console.log(
          "================================="
        );
      }
    );
  } catch (error) {
    console.error(
      "SERVER START ERROR:",
      error
    );

    process.exit(1);
  }
}

startServer();