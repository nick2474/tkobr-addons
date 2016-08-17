function pos_category_combo_discount(instance, module) { //module is instance.point_of_sale
    var QWeb = instance.web.qweb;
    var _t = instance.web._t;
    var round_pr = instance.web.round_precision;

    //to load for server disconnection
    module.PosModel.prototype.models.filter(function(m) {
        return m.model === 'pos.session';
    }).map(function(m) {
        return m.fields.push('combo_ids'),
            m;
    });
    //no need to load this model, we can't use without connection
    module.PosModel.prototype.models.push({
        model: 'pos.category.combo',
        fields: ['main_category_id', 'disc_category_id', 'type', 'value', 'company_id', 'company_ids'],
        loaded: function(self, combos) {
            self.combos = combos;
        }
    })

    //	exetnd to add discounted field in orderline it helps to apply combo discount 



    //Extend orderline to add discounted flag
    var orderline_id = 1;
    var OrderlineSuper = module.Orderline;
    module.Orderline = module.Orderline.extend({
        initialize: function(attr, options) {
            //commenting super call, on calling super it gives error with tko_point_of_sale_product_price_by_pos
            //it allows to call super only one time, second time calling super ends in Uncaught RangeError: Maximum call stack size exceeded
            //module.Orderline.__super__.initialize.call(this, attr, options);
            this.pos = options.pos;
            this.order = options.order;
            this.product = options.product;
            this.price = options.product.price;
            this.quantity = 1;
            this.quantityStr = '1';
            this.discount = 0;
            this.discountStr = '0';
            this.type = 'unit';
            this.selected = false;
            this.id = orderline_id++;
            //add variable with lines to set discount
            this.discounted = false;
            this.categ_id = options.product.pos_categ_id[0]
            this.default_code = options.product.default_code;
            this.discount_type = 'p'
            this.paired = false; // this is the line which is paired with the discounted line, used when we need to clear discount
        },

        get_discount_type: function() {
            return this.discount_type;
        },

        get_base_price: function() {
            var rounding = this.pos.currency.rounding;
            discount_type = this.get_discount_type();
            if (discount_type === 'fi') {
                return round_pr(this.get_unit_price() * this.get_quantity() - (this.get_discount()), rounding);
            } else {
                return round_pr(this.get_unit_price() * this.get_quantity() * (1 - this.get_discount() / 100), rounding);
            }

        },

        //send discount card type to write in database
        export_as_JSON: function() {
            var res = OrderlineSuper.prototype.export_as_JSON.call(this);
            res.discount_type = this.discount_type || false;
            return res;
        },

        // we do not want to merge newly added product, it becomes easier to discount multiple quantities of same product
        can_be_merged_with: function(quantity) {
            return false;
        },

        //this method clears discounted paired 
        // here are 2 cases deleted line might belong to any of category, i.e. discount and main category
        set_quantity: function(quantity) {
        	// if line is being removed
            if (quantity === 'remove' || quantity === '0' || !quantity) {
                var currentLine = this;
                // before was reading order from current line but giving error with pos_stocks and pos_return installed
                //var order = currentLine.order
                var  order  = this.pos.get('selectedOrder')
                var orderLines = order.get('orderLines').models;
                var found = false;
                _.each(orderLines, function(line) {
                    // find a line which can be replaced with current being deleted line
                    // if found set new found line in other lines as paired where currentline was
                    // search a line with same category and non-discounted
                    if (line.categ_id === currentLine.categ_id && line.discounted === false && line !== currentLine) {
                        found = true;
                        // unlink lines linked with currentLine and link them against new line
                        // CASE 1
                        // if deleted product is belonging to main category, that means discount lines are dependent on it
                        for (i = 0; i < orderLines.length; i++) {
                            if (orderLines[i].paired === currentLine && orderLines[i] !== currentLine) {
                                orderLines[i].paired = line;
                                orderLines[i].discounted = true; // set main line discounted
                            }
                        }
                        // CASE 1
                        // if deleted product is belonging to discount category, that means if it has some associated discount on it
                        for (i = 0; i < orderLines.length; i++) {
                            if (currentLine.discount > 0 && orderLines[i].categ_id === currentLine.categ_id && orderLines[i] !== currentLine && orderLines[i].discounted === false) {
                                orderLines[i].paired = currentLine.paired;
                                orderLines[i].discount_type = currentLine.discount_type;
                                orderLines[i].set_discount(currentLine.discount);
                                orderLines[i].discounted = true; // set discount line discounted
                                break;
                            }
                        }
                    }
                });
                // if no non-discounted line found with same category other than current line in CASE 1
                // then unlink discount lines associated with current line and set them non-discounted with 0 discount
                if (found === false) {
                    for (i = 0; i < orderLines.length; i++) {
                        if (orderLines[i].paired === currentLine) {
                            orderLines[i].set_discount(0);
                            orderLines[i].paired = false;
                            orderLines[i].discounted = false;
                        }

                    }
                }
                order.removeOrderline(this);
                return;
            } else {
                var quant = parseFloat(quantity) || 0;
                var unit = this.get_unit();
                if (unit) {
                    if (unit.rounding) {
                        this.quantity = round_pr(quant, unit.rounding);
                        this.quantityStr = this.quantity.toFixed(Math.ceil(Math.log(1.0 / unit.rounding) / Math.log(10)));
                    } else {
                        this.quantity = round_pr(quant, 1);
                        this.quantityStr = this.quantity.toFixed(0);
                    }
                } else {
                    this.quantity = quant;
                    this.quantityStr = '' + this.quantity;
                }
            }
            this.trigger('change', this);
        },

    });

    //Extend order to apply combo disocount each time a product is added
    var _super_order = instance.point_of_sale.Order.prototype;
    module.Order = module.Order.extend({




        fetch: function(model, fields, domain, ctx) {
            return new instance.web.Model(model).query(fields).filter(domain).context(ctx).all();
        },


        addProduct: function(product, options) {
            options = options || {};
            var attr = JSON.parse(JSON.stringify(product));
            attr.pos = this.pos;
            attr.order = this;
            /* this piece of code is for pos_return can work without adding in dependency 
             because both module inherit and override same function without calling super
             calling super adds duplicate lines
             */
            var return_id = false;
            try{
            	return_id = this.get_ret_o_id();
            }
            catch (error){
            	return_id = false;
            }
            if (return_id){
            	return _super_order.addProduct.call(this, product, options);
            }
            /* end pos_return related code */
            var line = new module.Orderline({}, {
                pos: this.pos,
                order: this,
                product: product
            });
            if (options.quantity !== undefined) {
                line.set_quantity(options.quantity);
            }
            if (options.price !== undefined) {
                line.set_unit_price(options.price);
            }
            if (options.discount !== undefined) {
                line.set_discount(options.discount);
            }

            var last_orderline = this.getLastOrderline();
            if (last_orderline && last_orderline.can_be_merged_with(line) && options.merge !== false) {
                last_orderline.merge(line);
            } else {
                this.get('orderLines').add(line);
            }
            this.selectLine(this.getLastOrderline());


            //TODO call and super do things here 
            var combo_ids = [];
            var filter_combo_ids = [];
            var categ_id = product.pos_categ_id[0];
            var order = this.pos.get('selectedOrder');
            var orderlines = order.get('orderLines').models;
            var pair_index = false;
            var line_to_discount = false;
            var flag = false;
            var currentline = line;
            if (categ_id) {
                // this variable holds category type 'm' for main and 'd' for discount
                // each category must have category type
                category_type = this.pos.db.get_category_by_id(categ_id).category_type
                if (this.pos) {
                    var combos = this.pos.combos;
                    //get all combo options 
                    _.each(combos, function(combos) {
                        //                		create array having [main_categ, disc_categ, type, value]
                        //to keep combos functioning for multi company
                        if (combos.company_ids.indexOf(this.posmodel.company.id) !== -1) {
                            combo_ids.push([combos.main_category_id[0], combos.disc_category_id[0], combos.type, combos.value]);
                        }

                    });
                }
                //filter array based on current product category
                filter_combo_ids = _.filter(combo_ids, function(combo) {

                    return combo.indexOf(categ_id) !== -1;
                });

                // iterate over all combos and set applicable discount
                _.each(filter_combo_ids, function(combo) {
                    var discount_type = combo[2];
                    var disc_value = combo[3];
                    _.each(orderlines, function(line) {
                        if ((line.categ_id) === combo[0]) {
                            // search discounted line against this main product if not found and exists then discount it
                            var found = false;
                            for (i = 0; i < orderlines.length; i++) {
                                if (orderlines[i].categ_id === combo[1] && orderlines[i].discounted === true && orderlines[i].paired === line) {
                                    found = true;
                                    break;
                                }
                            }
                            if (found === false) {
                                for (i = 0; i < orderlines.length; i++) {
                                    if (orderlines[i].categ_id === combo[1] && orderlines[i].discounted === false) {
                                        orderlines[i].discount_type = discount_type;
                                        orderlines[i].set_discount(disc_value);
                                        orderlines[i].paired = line;
                                        orderlines[i].discounted = true;
                                        line.discounted = true; // set main line discounted
                                        break;
                                    }
                                }
                            }
                        }
                    });
                });
            }
        },

    });
};