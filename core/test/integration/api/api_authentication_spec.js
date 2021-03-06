var testUtils   = require('../../utils'),
    should      = require('should'),
    _           = require('lodash'),
    sinon       = require('sinon'),
    Promise     = require('bluebird'),
    uid         = require('../../../server/utils').uid,
    globalUtils = require('../../../server/utils'),
    AuthAPI     = require('../../../server/api/authentication'),
    mail        = require('../../../server/api/mail'),
    models      = require('../../../server/models'),
    errors      = require('../../../server/errors'),
    sandbox     = sinon.sandbox.create(),
    context     = testUtils.context,
    Accesstoken,
    Refreshtoken,
    User;

// @TODO: group tests by api call, not by setup completed or not
describe('Authentication API', function () {
    var testInvite = {
            invitation: [{
                token: 'abc',
                password: 'abcdefgh',
                email: 'test@testghost.org',
                name: 'Jo Bloggs'
            }]
        },
        testGenerateReset = {
            passwordreset: [{
                email: 'jbloggs@example.com'
            }]
        },
        testReset = {
            passwordreset: [{
                token: 'abc',
                oldPassword: 'Sl1m3rson',
                newPassword: 'abcdefgh',
                ne2Password: 'abcdefgh'
            }]
        };

    // Keep the DB clean
    before(testUtils.teardown);
    afterEach(testUtils.teardown);

    // Stub mail
    beforeEach(function () {
        sandbox.stub(mail, 'send', function () {
            return Promise.resolve();
        });
    });
    afterEach(function () {
        sandbox.restore();
    });

    should.exist(AuthAPI);

    describe('Setup', function () {
        describe('Cannot run', function () {
            before(function () {
                User = require('../../../server/models/user').User;
            });

            beforeEach(testUtils.setup('roles', 'owner:pre', 'settings', 'perms:setting', 'perms:mail', 'perms:init'));

            describe('Invalid database state', function () {
                it('should not allow setup to be run if owner missing from database', function (done) {
                    var setupData = {
                        name: 'test user',
                        email: 'test@example.com',
                        password: 'areallygoodpassword',
                        blogTitle: 'a test blog'
                    };

                    User.fetchAll().call('invokeThen', 'destroy').then(function () {
                        AuthAPI.setup({setup: [setupData]}).then(function () {
                            done(new Error('Setup ran when it should not have.'));
                        }).catch(function (err) {
                            should.exist(err);
                            err.name.should.equal('InternalServerError');
                            err.statusCode.should.equal(500);

                            done();
                        }).catch(done);
                    });
                });
            });
        });

        describe('Not completed', function () {
            // TODO: stub settings
            beforeEach(testUtils.setup('roles', 'owner:pre', 'settings', 'perms:setting', 'perms:mail', 'perms:init'));

            it('should report that setup has not been completed', function (done) {
                AuthAPI.isSetup().then(function (result) {
                    should.exist(result);
                    result.setup[0].status.should.be.false();

                    done();
                }).catch(done);
            });

            it('should allow setup to be completed', function (done) {
                var setupData = {
                    name: 'test user',
                    email: 'test@example.com',
                    password: 'areallygoodpassword',
                    blogTitle: 'a test blog'
                };

                AuthAPI.setup({setup: [setupData]}).then(function (result) {
                    should.exist(result);
                    should.exist(result.users);
                    should.not.exist(result.meta);
                    result.users.should.have.length(1);
                    testUtils.API.checkResponse(result.users[0], 'user');

                    var newUser = result.users[0];

                    newUser.id.should.equal(1);
                    newUser.name.should.equal(setupData.name);
                    newUser.email.should.equal(setupData.email);

                    done();
                }).catch(done);
            });

            it('should allow setup to be completed without a blog title', function (done) {
                var setupData = {
                    name: 'test user',
                    email: 'test@example.com',
                    password: 'areallygoodpassword'
                };

                AuthAPI.setup({setup: [setupData]}).then(function (result) {
                    should.exist(result);
                    should.exist(result.users);
                    should.not.exist(result.meta);
                    result.users.should.have.length(1);
                    testUtils.API.checkResponse(result.users[0], 'user');

                    var newUser = result.users[0];

                    newUser.id.should.equal(1);
                    newUser.name.should.equal(setupData.name);
                    newUser.email.should.equal(setupData.email);

                    done();
                }).catch(done);
            });

            it('should return an error for an invitation check', function (done) {
                AuthAPI.isInvitation({email: 'a@example.com'}).then(function () {
                    done(new Error('Did not receive an error response'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('NoPermissionError');
                    err.statusCode.should.equal(403);

                    done();
                }).catch(done);
            });

            it('should not allow an invitation to be accepted', function (done) {
                AuthAPI.acceptInvitation(testInvite).then(function () {
                    done(new Error('Invitation was allowed to be accepted'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('NoPermissionError');
                    err.statusCode.should.equal(403);

                    done();
                }).catch(done);
            });

            it('should not generate a password reset token', function (done) {
                AuthAPI.generateResetToken(testGenerateReset).then(function () {
                    done(new Error('Reset token was generated'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('NoPermissionError');
                    err.statusCode.should.equal(403);

                    done();
                }).catch(done);
            });

            it('should not allow a password reset', function (done) {
                AuthAPI.resetPassword(testReset).then(function () {
                    done(new Error('Password was reset'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('NoPermissionError');
                    err.statusCode.should.equal(403);

                    done();
                }).catch(done);
            });
        });

        describe('Completed', function () {
            before(function () {
                Accesstoken = require('../../../server/models/accesstoken').Accesstoken;
                Refreshtoken = require('../../../server/models/refreshtoken').Refreshtoken;
                User = require('../../../server/models/user').User;
            });

            beforeEach(testUtils.setup('invites', 'roles', 'owner', 'clients', 'settings', 'perms:setting', 'perms:mail', 'perms:init'));

            it('should report that setup has been completed', function (done) {
                AuthAPI.isSetup().then(function (result) {
                    should.exist(result);
                    result.setup[0].status.should.be.true();

                    done();
                }).catch(done);
            });

            it('should not allow setup to be run again', function (done) {
                var setupData = {
                    name: 'test user',
                    email: 'test@example.com',
                    password: 'areallygoodpassword',
                    blogTitle: 'a test blog'
                };

                AuthAPI.setup({setup: [setupData]}).then(function () {
                    done(new Error('Setup was able to be run'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('NoPermissionError');
                    err.statusCode.should.equal(403);

                    done();
                }).catch(done);
            });

            it('should allow an invitation to be accepted, but fail on token validation', function (done) {
                AuthAPI.acceptInvitation(testInvite).then(function () {
                    done(new Error('invitation did not fail on token validation'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('NotFoundError');
                    err.statusCode.should.equal(404);
                    err.message.should.equal('Invite not found.');

                    done();
                }).catch(done);
            });

            it('should allow an invitation to be accepted', function () {
                var invite;

                return models.Invite.add({email: '123@meins.de', roles: [1]}, _.merge({}, {include: ['roles']}, context.internal))
                    .then(function (_invite) {
                        invite = _invite;
                        invite.toJSON().roles.length.should.eql(1);

                        return models.Invite.edit({status: 'sent'}, _.merge({}, {id: invite.id}, context.internal));
                    })
                    .then(function () {
                        return AuthAPI.acceptInvitation({
                            invitation: [
                                {
                                    token: invite.get('token'),
                                    email: invite.get('email'),
                                    name: invite.get('email'),
                                    password: 'eightcharacterslong'
                                }
                            ]
                        });
                    })
                    .then(function (res) {
                        should.exist(res.invitation[0].message);
                        return models.Invite.findOne({id: invite.id}, context.internal);
                    })
                    .then(function (_invite) {
                        should.not.exist(_invite);
                        return models.User.findOne({
                            email: invite.get('email')
                        }, _.merge({include: ['roles']}, context.internal));
                    })
                    .then(function (user) {
                        user.toJSON().roles.length.should.eql(1);
                    });
            });

            it('should not allow an invitation to be accepted: expired', function () {
                var invite;

                return models.Invite.add({email: '123@meins.de'}, context.internal)
                    .then(function (_invite) {
                        invite = _invite;

                        return models.Invite.edit({
                            status: 'sent',
                            expires: Date.now() - 10000}, _.merge({}, {id: invite.id}, context.internal));
                    })
                    .then(function () {
                        return AuthAPI.acceptInvitation({
                            invitation: [
                                {
                                    token: invite.get('token'),
                                    email: invite.get('email'),
                                    name: invite.get('email'),
                                    password: 'eightcharacterslong'
                                }
                            ]
                        });
                    })
                    .then(function () {
                        throw new Error('should not pass the test: expected expired invitation');
                    })
                    .catch(function (err) {
                        should.exist(err);
                        (err instanceof errors.NotFoundError).should.eql(true);
                        err.message.should.eql('Invite is expired.');
                    });
            });

            it('should generate a password reset token', function (done) {
                AuthAPI.generateResetToken(testGenerateReset).then(function (result) {
                    should.exist(result);
                    result.passwordreset.should.be.an.Array().with.lengthOf(1);
                    result.passwordreset[0].should.have.property('message', 'Check your email for further instructions.');
                    done();
                }).catch(done);
            });

            it('should not generate a password reset token for an invalid email address', function (done) {
                var badResetRequest = {
                        passwordreset: [{email: ''}]
                    };

                AuthAPI.generateResetToken(badResetRequest).then(function () {
                    done(new Error('reset token was generated for invalid email address'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('BadRequestError');
                    err.statusCode.should.equal(400);

                    done();
                }).catch(done);
            });

            it('should NOT allow a password reset', function (done) {
                AuthAPI.resetPassword(testReset).then(function () {
                    done(new Error('password reset did not fail on token validation'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('UnauthorizedError');
                    err.statusCode.should.equal(401);
                    err.message.should.equal('Invalid token structure');

                    done();
                }).catch(done);
            });

            it('should allow a password reset', function (done) {
                sandbox.stub(globalUtils.tokens.resetToken, 'generateHash').returns('valid-token');
                sandbox.stub(globalUtils.tokens.resetToken, 'extract').returns({email: 'jbloggs@example.com', expires: Date.now() + (60 * 1000)});
                sandbox.stub(globalUtils.tokens.resetToken, 'compare').returns(true);

                models.User.edit({status: 'locked'}, {id: 1})
                    .then(function (user) {
                        user.get('status').should.eql('locked');
                        return AuthAPI.generateResetToken(testGenerateReset);
                    })
                    .then(function () {
                        return AuthAPI.resetPassword(testReset);
                    })
                    .then(function () {
                        return models.User.findOne({id: 1});
                    })
                    .then(function (user) {
                        user.get('status').should.eql('active');

                        return models.User.isPasswordCorrect({
                            plainPassword: testReset.passwordreset[0].newPassword,
                            hashedPassword: user.get('password')
                        });
                    })
                    .then(function () {
                        done();
                    })
                    .catch(function (err) {
                        done(err);
                    });
            });

            it('should allow an access token to be revoked', function (done) {
                var id = uid(191);

                Accesstoken.add({
                    token: id,
                    expires: Date.now() + 8640000,
                    user_id: 1,
                    client_id: 1
                }).then(function (token) {
                    should.exist(token);
                    token.get('token').should.equal(id);

                    return AuthAPI.revoke({
                        token: token.get('token'),
                        token_type_hint: 'access_token'
                    });
                }).then(function (response) {
                    should.exist(response);
                    response.token.should.equal(id);

                    return Accesstoken.findOne({token: id});
                }).then(function (token) {
                    should.not.exist(token);

                    done();
                }).catch(done);
            });

            it('should know an email address has an active invitation', function () {
                return AuthAPI.isInvitation({email: testUtils.DataGenerator.forKnex.invites[0].email})
                    .then(function (response) {
                        should.exist(response);
                        response.invitation[0].valid.should.be.true();
                        response.invitation[0].invitedBy.should.eql('Joe Bloggs');
                    });
            });

            it('should know an email address does not have an active invitation', function (done) {
                var user = {
                        name: 'uninvited user',
                        email: 'notinvited@example.com',
                        password: '12345678',
                        status: 'active'
                    },
                    options = {
                        context: {internal: true}
                    };

                User.add(user, options).then(function (user) {
                    return AuthAPI.isInvitation({email: user.get('email')});
                }).then(function (response) {
                    should.exist(response);
                    response.invitation[0].valid.should.be.false();

                    done();
                }).catch(done);
            });

            it('should know an unknown email address is not an active invitation', function (done) {
                AuthAPI.isInvitation({email: 'unknown@example.com'}).then(function (response) {
                    should.exist(response);
                    response.invitation[0].valid.should.be.false();

                    done();
                }).catch(done);
            });

            it('should allow a refresh token to be revoked', function (done) {
                var id = uid(191);

                Refreshtoken.add({
                    token: id,
                    expires: Date.now() + 8640000,
                    user_id: 1,
                    client_id: 1
                }).then(function (token) {
                    should.exist(token);
                    token.get('token').should.equal(id);

                    return AuthAPI.revoke({
                        token: token.get('token'),
                        token_type_hint: 'refresh_token'
                    });
                }).then(function (response) {
                    should.exist(response);
                    response.token.should.equal(id);

                    return Refreshtoken.findOne({token: id});
                }).then(function (token) {
                    should.not.exist(token);

                    done();
                }).catch(done);
            });

            it('should return success when attempting to revoke an invalid token', function (done) {
                var id = uid(191);

                Accesstoken.add({
                    token: id,
                    expires: Date.now() + 8640000,
                    user_id: 1,
                    client_id: 1
                }).then(function (token) {
                    should.exist(token);
                    token.get('token').should.equal(id);

                    return AuthAPI.revoke({
                        token: 'notavalidtoken',
                        token_type_hint: 'access_token'
                    });
                }).then(function (response) {
                    should.exist(response);
                    response.token.should.equal('notavalidtoken');
                    response.error.should.equal('Invalid token provided');

                    done();
                }).catch(done);
            });
        });
    });

    describe('Setup Update', function () {
        describe('Setup not complete', function () {
            beforeEach(testUtils.setup('roles', 'owner:pre', 'settings', 'perms:setting', 'perms:init'));

            it('should report that setup has not been completed', function (done) {
                AuthAPI.isSetup().then(function (result) {
                    should.exist(result);
                    result.setup[0].status.should.be.false();

                    done();
                }).catch(done);
            });

            it('should not allow setup to be updated', function (done) {
                var setupData = {
                        name: 'test user',
                        email: 'test@example.com',
                        password: 'areallygoodpassword',
                        blogTitle: 'a test blog'
                    };

                AuthAPI.updateSetup({setup: [setupData]}, {}).then(function () {
                    done(new Error('Update was able to be run'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('NoPermissionError');
                    err.statusCode.should.equal(403);

                    done();
                }).catch(done);
            });
        });

        describe('Not Owner', function () {
            beforeEach(testUtils.setup('roles', 'users:roles', 'settings', 'perms:setting', 'perms:init', 'perms:user'));

            it('should report that setup has been completed', function (done) {
                AuthAPI.isSetup().then(function (result) {
                    should.exist(result);
                    result.setup[0].status.should.be.true();

                    done();
                }).catch(done);
            });

            it('should not allow setup to be updated', function (done) {
                var setupData = {
                        name: 'test user',
                        email: 'test@example.com',
                        password: 'areallygoodpassword',
                        blogTitle: 'a test blog'
                    };

                AuthAPI.updateSetup({setup: [setupData]}, context.author).then(function () {
                    done(new Error('Update was able to be run'));
                }).catch(function (err) {
                    should.exist(err);

                    err.name.should.equal('NoPermissionError');
                    err.statusCode.should.equal(403);

                    done();
                }).catch(done);
            });
        });

        describe('Owner', function () {
            beforeEach(testUtils.setup('roles', 'users:roles', 'settings', 'perms:setting', 'perms:init'));

            it('should report that setup has been completed', function (done) {
                AuthAPI.isSetup().then(function (result) {
                    should.exist(result);
                    result.setup[0].status.should.be.true();

                    done();
                }).catch(done);
            });

            it('should allow setup to be updated', function (done) {
                var setupData = {
                        name: 'test user',
                        email: 'test@example.com',
                        password: 'areallygoodpassword',
                        blogTitle: 'a test blog'
                    };

                AuthAPI.updateSetup({setup: [setupData]}, context.owner).then(function (result) {
                    should.exist(result);
                    should.exist(result.users);
                    should.not.exist(result.meta);
                    result.users.should.have.length(1);
                    testUtils.API.checkResponse(result.users[0], 'user');

                    var newUser = result.users[0];

                    newUser.id.should.equal(1);
                    newUser.name.should.equal(setupData.name);
                    newUser.email.should.equal(setupData.email);

                    done();
                }).catch(done);
            });
        });
    });
});
