'use strict';
const _ = require('lodash');
const constants = require('./constants');

exports._populate = (response_tree, _ac) => {
  if (typeof response_tree === 'object' && response_tree !== null) {
    // Map {kind: 't2', data: {name: 'some_username', ... }} to a RedditUser (e.g.) with the same properties
    if (_.keys(response_tree).length === 2 && response_tree.kind) {
      const remainder_of_tree = exports._populate(response_tree.data, _ac);
      if (constants.KINDS[response_tree.kind]) {
        return _ac._new_object(constants.KINDS[response_tree.kind], remainder_of_tree, true);
      }
      _ac.warn(
        `Warning: Unknown type '${response_tree.kind}'. This may be a bug, please report it: ${constants.ISSUE_REPORT_LINK}.`
      );
      return _ac._new_object('RedditContent', remainder_of_tree, true);
    }
    const mapFunction = Array.isArray(response_tree) ? _.map : _.mapValues;
    const result = mapFunction(response_tree, (value, key) => {
      // Map {..., author: 'some_username', ...} to {..., author: RedditUser {}, ... } (e.g.)
      if (_.includes(constants.USER_KEYS, key) && value !== null) {
        return _ac._new_object('RedditUser', {name: value}, false);
      }
      if (_.includes(constants.SUBREDDIT_KEYS, key) && value !== null) {
        return _ac._new_object('Subreddit', {display_name: value}, false);
      }
      return exports._populate(value, _ac);
    });
    if (result.length === 2 && result[0] && result[0].constructor.name === 'Listing' && result[0][0] &&
        result[0][0].constructor.name === 'Submission' && result[1] && result[1].constructor.name === 'Listing') {
      result[0][0].comments = result[1];
      return result[0][0];
    }
    return result;
  }
  return response_tree;
};

exports._add_empty_replies_listing = item => {
  if (item.constructor.name === 'Comment') {
    const replies_uri = `comments/${item.link_id.slice(3)}`;
    const replies_query = {comment: item.name.slice(3)};
    const _transform = response => response.comments[0].replies;
    item.replies = item._ac._new_object('Listing', {_uri: replies_uri, _query: replies_query, _transform});
  } else if (item.constructor.name === 'PrivateMessage') {
    item.replies = item._ac._new_object('Listing');
  }
  return item;
};

exports._handle_json_errors = returnValue => {
  return response => {
    if (_.isEmpty(response) || !response.json.errors.length) {
      return returnValue;
    }
    throw response.json.errors[0];
  };
};

// Performs a depth-first search of a tree of private messages, in order to find a message with a given name.
exports.find_message_in_tree = (desired_message_name, current_message) => {
  if (current_message.name === desired_message_name) {
    return current_message;
  }
  return _.find(current_message.replies.map(_.partial(exports.find_message_in_tree, desired_message_name)));
};

exports._format_permissions = (all_permission_names, permissions_array) => {
  if (!permissions_array) {
    return '+all';
  }
  return all_permission_names.map(type => (_.includes(permissions_array, type) ? '+' : '-') + type).join(',');
};

exports._format_mod_permissions = _.partial(exports._format_permissions, constants.MODERATOR_PERMISSIONS);
exports._format_livethread_permissions = _.partial(exports._format_permissions, constants.LIVETHREAD_PERMISSIONS);

exports.rename_key = (obj, oldkey, newkey) => obj && _(_.clone(obj)).assign({[newkey]: obj[oldkey]}).omit(oldkey).value();


/* When reddit returns private messages (or comments from the /api/morechildren endpoint), it arranges their in a very
nonintuitive way (see https://github.com/not-an-aardvark/snoowrap/issues/15 for details). This function rearranges the message
tree so that replies are threaded properly. */
exports._build_replies_tree = root_item => {
  const child_list = root_item.replies;
  const child_map = _.keyBy(child_list, 'name');
  child_list.forEach(exports._add_empty_replies_listing);
  _.remove(child_list, child => child_map[child.parent_id]).forEach(child => child_map[child.parent_id].replies.push(child));
  return root_item;
};
